// Web Bluetooth control for the Pollinator LED-flower "bouquets".
//
// Each ESP32 = one bouquet, advertising a single Nordic-UART-style service. Each
// flower exposes its own command characteristic (prefix 6e400002…) differing only in
// the last 5 hex digits (00000 / 00001 / 00002). We connect to a board, grab every
// command characteristic under the service, and fan each command out to all of them
// so the whole bouquet reacts together.
//
// MULTI-BOARD: we keep a LIST of connections (one per ESP32). The "Add ESP32" button
// calls connectFlowers() again to pop the picker and append another board. The global
// flower channel order is the concatenation of every board's flowers in the order the
// boards were connected — which matches flowerLayout's bouquet/flower ordering, so
// channel N drives layout flower N.
//
// Commands are JSON objects ({ co, mo, sp, br }) matching the firmware's `pollinate`
// protocol — JSON-stringified, chunked into ≤20-byte BLE packets, the stream
// terminated with ';' (MSG_TERMINATOR). See ~/Pollinator for the firmware side.
//
// Web Bluetooth only works in a secure context (the deployed HTTPS site or
// localhost) on Chromium browsers — notably NOT iOS Safari. Calls must originate
// from a user gesture (button click) the first time, or requestDevice() throws.

import { setFlowerState, stateFromCommand, getFlowerState } from './flowerState';

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const CMD_CHAR_PREFIX = '6e400002-b5a3-f393-e0a9-e50e24d';
const FRAME_CHAR_PREFIX = '6e400004'; // low-latency binary frame characteristic

const MSG_TERMINATOR = ';';
const MAX_PACKET_BYTES = 20;

// One entry per connected ESP32: { device, cmdChars, frameChar, autoReconnect }.
// Order = connect order = global flower channel order.
let conns = [];
let statusListeners = [];

// Test mode: pretend a board is connected so the whole UI/visualization can be
// driven without hardware. Writes become no-ops (no characteristics), but commands
// still update the shared flowerState, so the visualization animates as if live.
let testMode = false;
let testFlowerCount = 3;

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

// Flat list of every flower command characteristic across all boards, in board order.
function allCmdChars() {
  return conns.flatMap((c) => c.cmdChars);
}

// Discover and return the flower command + frame characteristics for one server.
async function discoverChars(server) {
  const service = await server.getPrimaryService(SERVICE_UUID);
  const chars = await service.getCharacteristics();
  // The binary frame characteristic (one, low-latency) is separate from the
  // per-flower command characteristics.
  const frameChar = chars.find((c) => c.uuid.toLowerCase().startsWith(FRAME_CHAR_PREFIX)) || null;
  const byPrefix = chars.filter((c) => c.uuid.toLowerCase().startsWith(CMD_CHAR_PREFIX));
  const writable = chars.filter(
    (c) => c.properties && (c.properties.write || c.properties.writeWithoutResponse) && !c.uuid.toLowerCase().startsWith(FRAME_CHAR_PREFIX),
  );
  const cmdChars = (byPrefix.length ? byPrefix : writable).sort((a, b) => a.uuid.localeCompare(b.uuid));
  return { cmdChars, frameChar };
}

// Fired when one board's GATT link drops (reset, out of range, or — most commonly —
// Chrome freezing a backgrounded tab). If the user didn't ask to disconnect that
// board, try to reconnect it (no user gesture needed for a known device).
async function handleDisconnect(conn) {
  conn.cmdChars = [];
  conn.frameChar = null;
  if (!conn.autoReconnect || !conn.device) { emitStatus(realConnected() ? 'connected' : 'disconnected'); return; }
  for (let attempt = 1; attempt <= 6 && conn.autoReconnect; attempt++) {
    emitStatus('reconnecting');
    try {
      // eslint-disable-next-line no-await-in-loop
      const server = await conn.device.gatt.connect();
      // eslint-disable-next-line no-await-in-loop
      const { cmdChars, frameChar } = await discoverChars(server);
      if (cmdChars.length) { conn.cmdChars = cmdChars; conn.frameChar = frameChar; emitStatus('connected'); return; }
    } catch { /* retry */ }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  if (conn.autoReconnect) emitStatus(realConnected() ? 'connected' : 'failed');
}

function realConnected() {
  return conns.some((c) => c.device && c.device.gatt && c.device.gatt.connected && c.cmdChars.length);
}

export function isConnected() {
  return testMode || realConnected();
}

// Number of connected flower channels (0 when disconnected). In test mode this is
// the reported layout total so every flower shows as connected.
export function getFlowerCount() {
  if (testMode) return testFlowerCount;
  return realConnected() ? allCmdChars().length : 0;
}

// Number of physically connected ESP32 boards (bouquets). Drives the "Add ESP32"
// button label and the per-board status line.
export function getDeviceCount() {
  if (testMode) return 1;
  return conns.filter((c) => c.device && c.device.gatt && c.device.gatt.connected && c.cmdChars.length).length;
}

// Names of the connected boards, in channel order (for status text).
export function getDeviceNames() {
  if (testMode) return ['Test board'];
  return conns
    .filter((c) => c.device && c.device.gatt && c.device.gatt.connected && c.cmdChars.length)
    .map((c) => c.device.name || 'ESP32');
}

export function isTestMode() { return testMode; }

// Enter/leave test mode (fakes a connection for testing the UI without hardware).
export function setTestMode(on) {
  testMode = !!on;
  emitStatus(testMode ? 'connected' : (realConnected() ? 'connected' : 'disconnected'));
}

// The visualization reports the total flower count so test mode lights them all and
// the engine spreads stereo across the right number.
export function setTestFlowerCount(n) {
  const next = Math.max(1, Number(n) || 1);
  if (next === testFlowerCount) return;
  testFlowerCount = next;
  // Notify subscribers so the visualization re-reads the count (test mode lights
  // every flower; without this it keeps a stale count and only some connect).
  emitStatus(isConnected() ? 'connected' : 'disconnected');
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
// characteristic — APPENDING the board to the connection list (so calling this again
// adds another ESP32 rather than replacing the first). Returns the total flower count
// discovered across all connected boards.
export async function connectFlowers() {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth is not available in this browser. Use Chrome on desktop or Android (iOS is unsupported).');
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID],
  });

  // Already connected to this board? Don't add it twice — just refresh its chars.
  let conn = conns.find((c) => c.device && c.device.id === device.id);
  if (!conn) {
    conn = { device, cmdChars: [], frameChar: null, autoReconnect: true };
    device.addEventListener('gattserverdisconnected', () => handleDisconnect(conn));
    conns.push(conn);
  }
  conn.autoReconnect = true;

  const server = await device.gatt.connect();
  const { cmdChars, frameChar } = await discoverChars(server);
  conn.cmdChars = cmdChars;
  conn.frameChar = frameChar;

  // eslint-disable-next-line no-console
  console.log('[flowerBle] connected to', device.name, '| flowers:', cmdChars.length, '| total boards:', getDeviceCount());

  if (!cmdChars.length) {
    // Drop the empty connection so it doesn't count as a board.
    conns = conns.filter((c) => c !== conn);
    throw new Error('Connected, but found no writable flower characteristics.');
  }
  emitStatus('connected');
  return allCmdChars().length;
}

// Disconnect every board (the "Disconnect" button) and forget them.
export async function disconnect() {
  const list = conns;
  conns = [];
  for (const c of list) {
    c.autoReconnect = false; // user asked to disconnect — don't fight it
    try {
      if (c.device && c.device.gatt && c.device.gatt.connected) c.device.gatt.disconnect();
    } catch { /* ignore */ }
  }
  emitStatus('disconnected');
}

// Write a single packet. The firmware command characteristic is write-WITH-response
// (aioble write=True), so prefer writeValue; only use the no-response variant when
// that's the only property the characteristic advertises.
async function writePacket(char, packet) {
  const p = char.properties || {};
  // Prefer write-without-response (no per-write ACK round-trip → much lower latency).
  if (p.writeWithoutResponse && char.writeValueWithoutResponse) {
    await char.writeValueWithoutResponse(packet);
  } else if (p.write || char.writeValue) {
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
  for (const char of allCmdChars()) {
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
  console.log('[flowerBle] send', JSON.stringify(command), '→', allCmdChars().length, 'flowers');
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

// Like sendReactive but with a distinct command per flower (for stereo spread).
// cmds[i] drives global channel i (across all boards); a shorter array reuses its
// last entry. Does NOT mirror to flowerState (the caller sets per-flower state).
export function sendReactivePerFlower(cmds) {
  if (_reactiveBusy || !isConnected()) return false;
  _reactiveBusy = true;
  const chars = allCmdChars();
  (async () => {
    for (let i = 0; i < chars.length; i += 1) {
      const cmd = cmds[i] || cmds[cmds.length - 1];
      if (!cmd) continue;
      const packets = splitIntoPackets(JSON.stringify(cmd));
      for (const packet of packets) {
        // eslint-disable-next-line no-await-in-loop
        await writePacket(chars[i], packet);
      }
    }
  })().catch(() => {}).finally(() => { _reactiveBusy = false; });
  return true;
}

// True when EVERY connected board exposes the low-latency binary frame characteristic
// (so a single per-board frame write can drive all flowers). If any board lacks it,
// the engine falls back to per-flower JSON, which spans boards transparently.
export function hasFrameChannel() {
  if (!isConnected()) return false;
  const live = conns.filter((c) => c.cmdChars.length);
  return live.length > 0 && live.every((c) => !!c.frameChar);
}

function hexToRgb(hex) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Low-latency path: send every flower's brightness + color as binary frames —
// one write-without-response PER BOARD, each carrying just that board's slice of the
// global frame array (in channel order). frames = [{ br: 0-100, co: '#rrggbb' }, …]
// in global flower order. Drops the round if a write is already in flight (always
// send the freshest). Returns false (so the engine falls back) unless every board has
// a frame char.
export function sendFrame(frames) {
  if (_reactiveBusy || !isConnected() || !hasFrameChannel()) return false;
  _reactiveBusy = true;
  const writes = [];
  let offset = 0;
  for (const c of conns) {
    const n = c.cmdChars.length;
    if (!n) continue;
    const slice = frames.slice(offset, offset + n);
    offset += n;
    const bytes = new Uint8Array(slice.length * 4);
    for (let i = 0; i < slice.length; i += 1) {
      const f = slice[i] || {};
      const [r, g, b] = hexToRgb(f.co || '#000000');
      bytes[i * 4] = Math.max(0, Math.min(255, Math.round((f.br || 0) * 2.55)));
      bytes[i * 4 + 1] = r;
      bytes[i * 4 + 2] = g;
      bytes[i * 4 + 3] = b;
    }
    const w = c.frameChar.writeValueWithoutResponse
      ? c.frameChar.writeValueWithoutResponse(bytes)
      : c.frameChar.writeValue(bytes);
    writes.push(Promise.resolve(w));
  }
  Promise.all(writes).catch(() => {}).finally(() => { _reactiveBusy = false; });
  return true;
}

async function writeCmdToChar(char, cmd, withResponse = false) {
  const packets = splitIntoPackets(JSON.stringify(cmd));
  for (const p of packets) {
    // eslint-disable-next-line no-await-in-loop
    if (withResponse && char.writeValue) await char.writeValue(p);
    // eslint-disable-next-line no-await-in-loop
    else await writePacket(char, p);
  }
}

// Flash one flower white, then restore it. `index` is a GLOBAL channel index across
// all boards. The white write is sent WITH response, so the returned promise resolves
// roughly when the board has acked it — i.e. ~one BLE round-trip. Returns null if that
// flower has no real channel (e.g. test mode).
export function flashFlower(index, ms = 280) {
  const char = allCmdChars()[index];
  if (!isConnected() || !char) return null;
  const p = writeCmdToChar(char, { co: '#ffffff', br: '100' }, true);
  setTimeout(() => {
    const s = getFlowerState();
    const pf = (Array.isArray(s.perFlower) && s.perFlower[index]) || s;
    writeCmdToChar(char, { co: pf.color || '#000000', br: String(Math.round(pf.brightness ?? 0)) }).catch(() => {});
  }, ms);
  return p;
}

// Re-initialize every strip (firmware re-creates its NeoPixel driver and pushes a
// fresh frame), recovering a flower stuck in a dark/glitched state — the BLE
// equivalent of the USB diagnostic. Colors are preserved by the firmware.
export async function refreshFlowers() {
  if (!isConnected()) throw new Error('Not connected to the flowers.');
  await writeCommand({ ri: '1' });
}

// Identification mode: light each flower a distinct solid color so you can physically
// map a channel to a flower in the room. `colors` is indexed by GLOBAL channel — a hex
// string per flower, or '#000000'/null for "off". Stops motion and mirrors the colors
// into flowerState.perFlower so the on-screen visualization shows the same mapping
// (works in test mode too). Hardware writes go WITH response so the colors hold.
export async function identifyFlowers(colors) {
  const perFlower = colors.map((c) => {
    const co = (typeof c === 'string' && c) ? c : '#000000';
    return { color: co, brightness: co === '#000000' ? 0 : 100 };
  });
  setFlowerState({ perFlower });
  const chars = allCmdChars();
  for (let i = 0; i < chars.length; i += 1) {
    const co = perFlower[i]?.color || '#000000';
    // eslint-disable-next-line no-await-in-loop
    await writeCmdToChar(chars[i], { mo: [], br: '100', co }, true);
  }
}

// Leave identification mode: drop the per-flower override so the viz returns to the
// shared live color. (The caller restores the hardware to a solid color afterward.)
export function clearIdentify() {
  setFlowerState({ perFlower: null });
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
