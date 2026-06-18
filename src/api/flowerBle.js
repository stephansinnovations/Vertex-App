// Web Bluetooth control for the "Bouquet 1" ESP32 LED flowers (Pollinator firmware).
//
// The board advertises a single Nordic-UART-style service. Each flower exposes its
// own command characteristic (prefix 6e400002…) differing only in the last 5 hex
// digits (00000 / 00001 / 00002). We connect once, grab every command characteristic
// under the service, and fan each command out to all of them so the whole bouquet
// reacts together.
//
// Commands are JSON objects ({ co, mo, sp, br }) matching the firmware's `pollinate`
// protocol — JSON-stringified, chunked into ≤20-byte BLE packets, the stream
// terminated with ';' (MSG_TERMINATOR). See ~/Pollinator for the firmware side.
//
// Web Bluetooth only works in a secure context (the deployed HTTPS site or
// localhost) on Chromium browsers — notably NOT iOS Safari. Calls must originate
// from a user gesture (button click) the first time, or requestDevice() throws.

import { setFlowerState, stateFromCommand } from './flowerState';

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const CMD_CHAR_PREFIX = '6e400002-b5a3-f393-e0a9-e50e24d';

const MSG_TERMINATOR = ';';
const MAX_PACKET_BYTES = 20;

let device = null;
let cmdChars = [];
let autoReconnect = false;
let statusListeners = [];

export function isBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

// Subscribe to connection status: 'connected' | 'reconnecting' | 'disconnected' |
// 'failed'. Returns an unsubscribe function.
export function onStatus(cb) {
  statusListeners.push(cb);
  return () => { statusListeners = statusListeners.filter((x) => x !== cb); };
}
function emitStatus(s) {
  statusListeners.forEach((cb) => { try { cb(s); } catch { /* ignore */ } });
}

// Discover and cache the flower command characteristics from a connected server.
async function discoverChars(server) {
  const service = await server.getPrimaryService(SERVICE_UUID);
  const chars = await service.getCharacteristics();
  const writable = chars.filter(
    (c) => c.properties && (c.properties.write || c.properties.writeWithoutResponse),
  );
  cmdChars = (writable.length
    ? writable
    : chars.filter((c) => c.uuid.toLowerCase().startsWith(CMD_CHAR_PREFIX))
  ).sort((a, b) => a.uuid.localeCompare(b.uuid));
  return cmdChars.length;
}

// Fired when the GATT link drops (board reset, out of range, or — most commonly —
// Chrome freezing a backgrounded tab). If the user didn't ask to disconnect, try
// to reconnect to the same device (no user gesture needed for a known device).
async function handleDisconnect() {
  cmdChars = [];
  if (!autoReconnect || !device) { emitStatus('disconnected'); return; }
  for (let attempt = 1; attempt <= 6 && autoReconnect; attempt++) {
    emitStatus('reconnecting');
    try {
      // eslint-disable-next-line no-await-in-loop
      const server = await device.gatt.connect();
      // eslint-disable-next-line no-await-in-loop
      await discoverChars(server);
      if (cmdChars.length) { emitStatus('connected'); return; }
    } catch { /* retry */ }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  if (autoReconnect) emitStatus('failed');
}

export function isConnected() {
  return !!(device && device.gatt && device.gatt.connected && cmdChars.length);
}

// Number of flower command channels on the connected device (0 when disconnected).
// Each channel maps, in order, to a flower in the app's layout.
export function getFlowerCount() {
  return isConnected() ? cmdChars.length : 0;
}

// Split a string into ≤maxBytes UTF-8 packets, appending the terminator to the
// stream first (mirrors the controller app's splitIntoPackets).
function splitIntoPackets(message, maxBytes = MAX_PACKET_BYTES) {
  const full = message + MSG_TERMINATOR;
  const bytes = new TextEncoder().encode(full);
  const packets = [];
  for (let i = 0; i < bytes.length; i += maxBytes) {
    packets.push(bytes.slice(i, i + maxBytes));
  }
  return packets;
}

// Prompt the browser device picker, connect GATT, and cache every flower command
// characteristic. Returns the flower count discovered.
export async function connectFlowers() {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth is not available in this browser. Use Chrome on desktop or Android (iOS is unsupported).');
  }

  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID],
  });

  // Only attach the disconnect handler once per device object.
  device.removeEventListener('gattserverdisconnected', handleDisconnect);
  device.addEventListener('gattserverdisconnected', handleDisconnect);
  autoReconnect = true;

  const server = await device.gatt.connect();
  await discoverChars(server);

  // eslint-disable-next-line no-console
  console.log('[flowerBle] connected to', device.name, '| using cmd chars:', cmdChars.map((c) => c.uuid));

  if (!cmdChars.length) {
    throw new Error('Connected, but found no writable flower characteristics.');
  }
  emitStatus('connected');
  return cmdChars.length;
}

export async function disconnect() {
  autoReconnect = false; // user asked to disconnect — don't fight it
  try {
    if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
  } finally {
    cmdChars = [];
    emitStatus('disconnected');
  }
}

// Write a single packet. The firmware command characteristic is write-WITH-response
// (aioble write=True), so prefer writeValue; only use the no-response variant when
// that's the only property the characteristic advertises.
async function writePacket(char, packet) {
  const p = char.properties || {};
  if (p.write) {
    await char.writeValue(packet);
  } else if (p.writeWithoutResponse) {
    await char.writeValueWithoutResponse(packet);
  } else if (char.writeValue) {
    await char.writeValue(packet);
  } else {
    await char.writeValueWithoutResponse(packet);
  }
}

// Low-level: write a command object to every flower characteristic, and mirror it
// into the shared live state so the visualization tracks what's actually playing.
async function writeCommand(command) {
  const patch = stateFromCommand(command);
  if (Object.keys(patch).length) setFlowerState(patch);
  const packets = splitIntoPackets(JSON.stringify(command));
  for (const char of cmdChars) {
    for (const packet of packets) {
      // eslint-disable-next-line no-await-in-loop
      await writePacket(char, packet);
    }
  }
}

// Send one command object to every flower. e.g. sendCommand({ co: '#FF0000' }).
export async function sendCommand(command) {
  if (!isConnected()) throw new Error('Not connected to the flowers.');
  // eslint-disable-next-line no-console
  console.log('[flowerBle] send', JSON.stringify(command), '→', cmdChars.length, 'flowers');
  await writeCommand(command);
}

// Fire-and-forget command for the audio loop. If a write is already in flight (BLE
// is slower than the animation frame rate), the frame is dropped rather than queued,
// so we always send the freshest value and never lag behind the music. Returns true
// if the write was started, false if dropped.
let _reactiveBusy = false;
export function sendReactive(command) {
  if (_reactiveBusy || !isConnected()) return false;
  _reactiveBusy = true;
  writeCommand(command)
    .catch(() => {})
    .finally(() => { _reactiveBusy = false; });
  return true;
}

// Light the flowers a solid color (no motion). Used for instant feedback on connect
// and when the user just wants steady color.
export async function setSolid(color, brightness = 100) {
  await sendCommand({ br: String(brightness) });
  await sendCommand({ mo: [] });
  await sendCommand({ co: color });
}

// Push just brightness (0-100) live.
export async function setBrightness(brightness) {
  await sendCommand({ br: String(brightness) });
}

// Convenience: start a coloured wave across the bouquet.
//   color: '#RRGGBB', speed: 1-100 (firmware update rate), brightness: 0-100.
export async function startWave(color, { speed = 20, brightness = 100 } = {}) {
  await sendCommand({ co: color });
  await sendCommand({ br: String(brightness) });
  await sendCommand({ sp: String(speed) });
  await sendCommand({ mo: ['wave'] });
}

// Stop motion and clear the flowers.
export async function stop() {
  await sendCommand({ mo: [] });
  await sendCommand({ co: '#000000' });
}
