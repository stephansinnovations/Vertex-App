// Shared model of what the bouquet is currently showing, so the visualization can
// mirror the live output (color, brightness, motion, speed). Every BLE command path
// updates this; the visualization subscribes. Commands go to all flowers, so a
// single shared state reflects the whole bouquet.

let state = { color: '#8b5cf6', brightness: 100, motion: [], speed: 25 };
let listeners = [];

export function getFlowerState() { return state; }

export function setFlowerState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => { try { l(state); } catch { /* ignore */ } });
}

export function onFlowerState(cb) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((x) => x !== cb); };
}

// Derive a state patch from a raw flower command object ({ co, br, mo, sp }).
export function stateFromCommand(cmd) {
  const patch = {};
  if (typeof cmd.co === 'string' && /^#[0-9a-f]{6}$/i.test(cmd.co)) patch.color = cmd.co;
  if (cmd.br !== undefined && cmd.br !== null && !Number.isNaN(Number(cmd.br))) patch.brightness = Number(cmd.br);
  if (Array.isArray(cmd.mo)) patch.motion = cmd.mo;
  if (cmd.sp !== undefined && cmd.sp !== null && !Number.isNaN(Number(cmd.sp))) patch.speed = Number(cmd.sp);
  return patch;
}
