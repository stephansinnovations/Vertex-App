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
import { sendReactivePerFlower, getFlowerCount } from './flowerBle';
import { hsvToHex } from './audioReactive';

export const MODES = ['Trigger', 'Loop', 'Sync'];
const MAX_DELAY_SEC = 4;

// Output ranges for the three modulatable parameters.
const RANGES = { brightness: [0, 100], color: [0, 360], speed: [6, 60] };

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
      band: 'none', // 'none' | 'bass' | 'drums' | 'melody' — follow a live band envelope
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
    this.audioLevel = 0; // 0..1 live music level while detecting tempo
    this.detecting = false; // listening for BPM
    this.bands = { bass: 0, drums: 0, melody: 0 }; // live band envelopes (0..1)
    this._startTime = 0;
    this.macros = [0, 1, 2, 3].map((i) => ({ name: `Macro ${i + 1}`, base: 0, source: NONE, amount: 1, value: 0 }));
    // Per-target parameter settings keyed by target id: 'all' | `b<bi>` | `f<gi>`.
    // 'all' holds defaults; child targets are sparse (source '' / manual null = inherit).
    this.targets = {
      all: {
        brightness: { source: NONE, manual: 100 },
        color: { source: NONE, manual: '#8b5cf6' },
        speed: { source: NONE, manual: 30 },
      },
    };
    this.flowerBouquet = []; // global flower index -> bouquet index
    this.running = false;
    this.listeners = [];
    this._raf = null;
    this._last = 0;
    this._lastSend = 0;
    this._emitCounter = 0;
  }

  subscribe(cb) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter((x) => x !== cb); }; }
  emit() { this.listeners.forEach((l) => { try { l(this); } catch { /* ignore */ } }); }

  getTarget(id) {
    if (!this.targets[id]) {
      this.targets[id] = {
        brightness: { source: NONE, manual: null },
        color: { source: NONE, manual: null },
        speed: { source: NONE, manual: null },
      };
    }
    return this.targets[id];
  }

  // global flower index -> bouquet index (reported by the visualization).
  setFlowerMap(map) { this.flowerBouquet = Array.isArray(map) ? map : []; }

  // Resolve a param's effective { source, manual } for flower gi via the target
  // hierarchy: flower override → bouquet override → 'all'.
  _resolveParam(name, gi) {
    const bi = this.flowerBouquet[gi] ?? 0;
    const chain = [this.targets[`f${gi}`], this.targets[`b${bi}`], this.targets.all];
    let source = NONE;
    let manual = null;
    for (const t of chain) { if (t && !source && t[name].source) source = t[name].source; }
    for (const t of chain) { if (t && manual == null && t[name].manual != null) manual = t[name].manual; }
    if (manual == null) manual = this.targets.all[name].manual;
    return { source, manual };
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
    this._emitOutput(true); // hold the current static (manual) state
    this.emit();
  }

  // Call on a detected beat — retriggers any LFO in Trigger mode (phase-lock to beat).
  onBeat() {
    const now = performance.now();
    for (const lfo of this.lfos) {
      if (lfo.mode === 'Trigger') { lfo._trigTime = now; lfo.phase = 0; }
    }
  }

  _macroVals(lvals) {
    return this.macros.map((m) => {
      let v = m.base;
      if (m.source) { const [k, i] = m.source.split(':'); if (k === 'lfo') v += (lvals[Number(i)] ?? 0) * m.amount; }
      return Math.max(0, Math.min(1, v));
    });
  }

  // Full command for one flower (gi), resolving each param from its target chain.
  _flowerCmd(gi, lvals, mvals) {
    const resolveSrc = (src) => {
      if (!src) return null;
      const [k, i] = src.split(':');
      if (k === 'lfo') return lvals[Number(i)] ?? null;
      if (k === 'macro') return mvals[Number(i)] ?? null;
      return null;
    };
    const cmd = {};
    {
      const { source, manual } = this._resolveParam('brightness', gi);
      const v = resolveSrc(source); const [min, max] = RANGES.brightness;
      cmd.br = String(Math.round(v != null ? min + (max - min) * v : manual));
    }
    {
      const { source, manual } = this._resolveParam('color', gi);
      const v = resolveSrc(source); const [min, max] = RANGES.color;
      cmd.co = v != null ? hsvToHex(min + (max - min) * v, 1, 1) : manual;
    }
    {
      const { source, manual } = this._resolveParam('speed', gi);
      const v = resolveSrc(source); const [min, max] = RANGES.speed;
      cmd.sp = String(Math.round(v != null ? min + (max - min) * v : manual));
    }
    return cmd;
  }

  // Compute every flower's output, update the live state (viz), and optionally send.
  _emitOutput(doSend) {
    const F = Math.max(getFlowerCount() || this.flowerBouquet.length || 3, 1);
    const cmds = [];
    const perFlower = [];
    for (let gi = 0; gi < F; gi += 1) {
      const lvals = this.lfos.map((l) => ((l.stereo > 0.001 && (!l.band || l.band === 'none'))
        ? sampleCurve(l.points, (l.phase + l.stereo * (gi / F)) % 1)
        : l.value));
      const mvals = this._macroVals(lvals);
      const cmd = this._flowerCmd(gi, lvals, mvals);
      cmds.push(cmd);
      const st = stateFromCommand(cmd);
      perFlower.push({ color: st.color, brightness: st.brightness });
    }
    const first = stateFromCommand(cmds[0] || {});
    setFlowerState({ ...first, perFlower });
    if (doSend) sendReactivePerFlower(cmds);
  }

  // Apply the current (static) settings once — for manual changes while stopped.
  applyOnce() { this._emitOutput(true); }

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
      if (lfo.band && lfo.band !== 'none') {
        // Follow the live band envelope (bass / drums / melody) instead of the curve.
        raw = this.bands[lfo.band] ?? 0;
      } else if (since < delaySec) {
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
    const mv = this._macroVals(this.lfos.map((l) => l.value));
    this.macros.forEach((m, i) => { m.value = mv[i]; });

    // Compute + send every flower's output (throttled to ~16fps).
    if (now - this._lastSend > 60) { this._lastSend = now; this._emitOutput(true); }

    // Throttle UI notifications to ~20fps.
    this._emitCounter += 1;
    if (this._emitCounter % 3 === 0) this.emit();
  };
}

export const modEngine = new ModEngine();
