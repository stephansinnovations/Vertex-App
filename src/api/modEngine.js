// Modulation engine — Vital-style LFOs driving the flowers (and the live viz).
//
// Signal flow:  LFO ──(optional)──▶ Macro ──▶ Parameter (Brightness / Color / Speed)
//               LFO ─────────────────────────▶ Parameter (direct)
//
// Each LFO has an editable curve (points with per-point bend), a rate (Hz) and a
// smoothing amount. The engine advances each LFO's phase over real time, samples its
// curve, feeds macros, then maps the chosen source onto each parameter's range. Every
// tick it updates the shared flowerState (so the visualization shows it) and sends a
// rate-limited, frame-dropping command to the flowers.

import { setFlowerState, stateFromCommand } from './flowerState';
import { sendReactive, sendReactivePerFlower, getFlowerCount } from './flowerBle';
import { hsvToHex } from './audioReactive';

export const MODES = ['Trigger', 'Loop', 'Sync'];
const MAX_DELAY_SEC = 4;

// --- Curve sampling -------------------------------------------------------------

// Bend a 0..1 segment fraction. curve in [-1,1]: 0 = linear, >0 = ease-in (slow
// start, like the exponential Vital example), <0 = ease-out.
function bend(t, curve) {
  if (!curve || Math.abs(curve) < 1e-4) return t;
  const k = curve * 6;
  return (Math.exp(k * t) - 1) / (Math.exp(k) - 1);
}

// Sample a curve (sorted points {x,y,curve}) at phase 0..1.
export function sampleCurve(points, phase) {
  if (!points || points.length === 0) return 0;
  if (points.length === 1) return points[0].y;
  const p = Math.min(0.999999, Math.max(0, phase));
  let i = 0;
  while (i < points.length - 1 && points[i + 1].x <= p) i += 1;
  const a = points[i];
  const b = points[i + 1] || points[i];
  const span = b.x - a.x;
  const t = span > 1e-6 ? (p - a.x) / span : 0;
  return a.y + (b.y - a.y) * bend(t, a.curve || 0);
}

// --- Presets --------------------------------------------------------------------

export const PRESETS = {
  Triangle: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }],
  'Saw Up': [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  'Saw Down': [{ x: 0, y: 1 }, { x: 1, y: 0 }],
  Square: [{ x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }],
  Sine: [
    { x: 0, y: 0.5, curve: 0.55 }, { x: 0.25, y: 1 }, { x: 0.5, y: 0.5, curve: 0.55 },
    { x: 0.75, y: 0 }, { x: 1, y: 0.5 },
  ],
  Ramp: [{ x: 0, y: 0 }, { x: 0.5, y: 1, curve: 0 }, { x: 1, y: 1 }],
};

export const PRESET_NAMES = Object.keys(PRESETS);
const clonePoints = (pts) => pts.map((p) => ({ x: p.x, y: p.y, curve: p.curve || 0 }));

// Source ids used by macros/params: '' = none, 'lfo:<i>', 'macro:<i>'.
export const NONE = '';

// Tempo-sync divisions → length of one LFO cycle in quarter-note beats.
export const SYNC_DIVISIONS = {
  '4 bars': 16, '2 bars': 8, '1 bar': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25,
};
export const SYNC_NAMES = Object.keys(SYNC_DIVISIONS);

// Effective LFO frequency (Hz): free uses its own rate; synced derives from BPM.
export function effectiveRate(lfo, bpm) {
  if (!lfo.sync || lfo.sync === 'free') return lfo.rate;
  const beats = SYNC_DIVISIONS[lfo.sync] || 1;
  return (bpm / 60) / beats;
}

class ModEngine {
  constructor() {
    this.lfos = [0, 1, 2, 3].map((i) => ({
      name: `LFO ${i + 1}`,
      points: clonePoints(PRESETS.Triangle),
      preset: 'Triangle',
      rate: 0.5, // Hz (used when sync === 'free')
      sync: '1/2', // 'free' or a SYNC_DIVISIONS key
      mode: 'Loop', // Trigger | Loop | Sync
      smooth: 0, // 0..1
      delay: 0, // 0..1 → onset delay after (re)trigger
      stereo: 0, // 0..1 → phase spread across flowers
      gridX: 8, // horizontal grid divisions
      phase: 0,
      value: 0,
      _smoothed: 0,
      _trigTime: 0,
    }));
    this.bpm = 120;
    this._startTime = 0;
    this.macros = [0, 1, 2, 3].map((i) => ({ name: `Macro ${i + 1}`, base: 0, source: NONE, amount: 1, value: 0 }));
    this.params = {
      brightness: { source: NONE, min: 0, max: 100 },
      color: { source: NONE, min: 0, max: 360 },
      speed: { source: NONE, min: 6, max: 60 },
    };
    this.running = false;
    this.listeners = [];
    this._raf = null;
    this._last = 0;
    this._lastSend = 0;
    this._emitCounter = 0;
  }

  subscribe(cb) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter((x) => x !== cb); }; }
  emit() { this.listeners.forEach((l) => { try { l(this); } catch { /* ignore */ } }); }

  _resolve(source) {
    if (!source) return null;
    const [kind, idxStr] = source.split(':');
    const idx = Number(idxStr);
    if (kind === 'lfo') return this.lfos[idx]?.value ?? null;
    if (kind === 'macro') return this.macros[idx]?.value ?? null;
    return null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const now = performance.now();
    this._last = now;
    this._startTime = now;
    for (const lfo of this.lfos) { lfo._trigTime = now; lfo.phase = 0; }
    this._tick();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.emit();
  }

  // Call on a detected beat — retriggers any LFO in Trigger mode (phase-lock to beat).
  onBeat() {
    const now = performance.now();
    for (const lfo of this.lfos) {
      if (lfo.mode === 'Trigger') { lfo._trigTime = now; lfo.phase = 0; }
    }
  }

  // Build a flower command from an array of per-LFO values (so stereo can recompute
  // with phase-offset LFO values per flower).
  _commandFrom(lfoValues) {
    const macroVals = this.macros.map((m) => {
      let v = m.base;
      if (m.source) {
        const [kind, i] = m.source.split(':');
        if (kind === 'lfo') v += (lfoValues[Number(i)] ?? 0) * m.amount;
      }
      return Math.max(0, Math.min(1, v));
    });
    const resolve = (src) => {
      if (!src) return null;
      const [kind, i] = src.split(':');
      if (kind === 'lfo') return lfoValues[Number(i)] ?? null;
      if (kind === 'macro') return macroVals[Number(i)] ?? null;
      return null;
    };
    const cmd = {};
    const b = resolve(this.params.brightness.source);
    if (b != null) { const { min, max } = this.params.brightness; cmd.br = String(Math.round(min + (max - min) * b)); }
    const c = resolve(this.params.color.source);
    if (c != null) { const { min, max } = this.params.color; cmd.co = hsvToHex(min + (max - min) * c, 1, 1); }
    const s = resolve(this.params.speed.source);
    if (s != null) { const { min, max } = this.params.speed; cmd.sp = String(Math.round(min + (max - min) * s)); }
    return cmd;
  }

  _tick = () => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;

    // Advance + sample each LFO per its mode, with onset delay.
    for (const lfo of this.lfos) {
      const freq = effectiveRate(lfo, this.bpm);
      const since = (now - (lfo._trigTime || now)) / 1000;
      const delaySec = (lfo.delay || 0) * MAX_DELAY_SEC;
      let raw;
      if (since < delaySec) {
        lfo.phase = 0; // hold at start during the delay
        raw = sampleCurve(lfo.points, 0);
      } else if (lfo.mode === 'Sync') {
        lfo.phase = (((now - this._startTime) / 1000) * freq) % 1;
        raw = sampleCurve(lfo.points, lfo.phase);
      } else {
        lfo.phase = (lfo.phase + dt * freq) % 1;
        raw = sampleCurve(lfo.points, lfo.phase);
      }
      if (lfo.smooth > 0) {
        const coeff = Math.exp(-dt / (0.015 + lfo.smooth * 0.6));
        lfo._smoothed = lfo._smoothed * coeff + raw * (1 - coeff);
        lfo.value = lfo._smoothed;
      } else {
        lfo.value = raw;
        lfo._smoothed = raw;
      }
    }

    // Macros (for the live meters).
    for (const m of this.macros) {
      let v = m.base;
      const s = this._resolve(m.source);
      if (s != null) v += s * m.amount;
      m.value = Math.max(0, Math.min(1, v));
    }

    const baseVals = this.lfos.map((l) => l.value);
    const anyStereo = this.lfos.some((l) => l.stereo > 0.001);
    const send = now - this._lastSend > 70;

    if (!anyStereo) {
      const cmd = this._commandFrom(baseVals);
      if (Object.keys(cmd).length) {
        setFlowerState({ ...stateFromCommand(cmd), perFlower: null });
        if (send) { this._lastSend = now; sendReactive(cmd); }
      }
    } else {
      // Per-flower: offset each LFO's phase across the bouquet for a stereo spread.
      const F = Math.max(getFlowerCount() || 3, 1);
      const cmds = [];
      const perFlower = [];
      for (let k = 0; k < F; k += 1) {
        const vals = this.lfos.map((l) => (l.stereo > 0.001
          ? sampleCurve(l.points, (l.phase + l.stereo * (k / F)) % 1)
          : l.value));
        const cmd = this._commandFrom(vals);
        cmds.push(cmd);
        const st = stateFromCommand(cmd);
        perFlower.push({ color: st.color, brightness: st.brightness });
      }
      const first = stateFromCommand(cmds[0] || {});
      setFlowerState({ ...first, perFlower });
      if (send && Object.keys(cmds[0] || {}).length) { this._lastSend = now; sendReactivePerFlower(cmds); }
    }

    // Throttle UI notifications to ~20fps.
    this._emitCounter += 1;
    if (this._emitCounter % 3 === 0) this.emit();
  };
}

export const modEngine = new ModEngine();
