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
import { sendReactivePerFlower, sendFrame, hasFrameChannel, getFlowerCount } from './flowerBle';
import { hsvToHex } from './audioReactive';

export const MODES = ['Trigger', 'Loop', 'Sync'];
const MAX_DELAY_SEC = 4;

// Output ranges for the three modulatable parameters.
const RANGES = { brightness: [0, 100], color: [0, 360], speed: [6, 60] };

export const PATTERN_TYPES = ['sweep', 'ripple', 'bounce', 'radiate', 'scatter'];

// Mix two hex colors. t=0 → a, t=1 → b.
export function mixHex(a, b, t) {
  const pa = parseInt((a || '#000000').slice(1), 16);
  const pb = parseInt((b || '#000000').slice(1), 16);
  const ar = (pa >> 16) & 255; const ag = (pa >> 8) & 255; const ab = pa & 255;
  const br = (pb >> 16) & 255; const bg = (pb >> 8) & 255; const bb = pb & 255;
  const to = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${to(ar + (br - ar) * t)}${to(ag + (bg - ag) * t)}${to(ab + (bb - ab) * t)}`;
}

// Map a spatial pattern onto a set of 0..1 canvas positions → a phase offset (in
// cycles) per position. Direction (degrees) sets the sweep axis. Pure + exported so
// the pattern-preview screen and the engine compute the same thing.
export function computePatternOffsets(pattern, positions) {
  const n = positions.length;
  const out = new Array(n).fill(0);
  const { type, direction = 0, amount = 0 } = pattern || {};
  if (!amount || n === 0) return out;
  if (type === 'scatter') {
    for (let i = 0; i < n; i += 1) out[i] = amount * (Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1);
    return out;
  }
  if (type === 'radiate') {
    let maxD = 1e-6;
    const ds = positions.map((p) => { const d = Math.hypot(p.x - 0.5, p.y - 0.5); if (d > maxD) maxD = d; return d; });
    for (let i = 0; i < n; i += 1) out[i] = amount * (ds[i] / maxD);
    return out;
  }
  // Projection onto the direction axis, normalized across the flowers.
  const rad = (direction * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let mn = Infinity;
  let mx = -Infinity;
  const projs = positions.map((p) => { const pr = p.x * cos + p.y * sin; if (pr < mn) mn = pr; if (pr > mx) mx = pr; return pr; });
  const span = Math.max(1e-6, mx - mn);
  for (let i = 0; i < n; i += 1) {
    const t = (projs[i] - mn) / span;
    out[i] = type === 'bounce' ? amount * (1 - Math.abs(2 * t - 1)) : amount * t;
  }
  return out;
}

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

// Live "Sync to music" signals that can drive an LFO's rate: the kick or a band
// envelope (0..1) scales the speed — slow at silence, fast at the envelope's peak.
// Keys match modEngine.kick / modEngine.bands.*.
export const AUDIO_RATE_SOURCES = { kick: 'Kick', bass: 'Bass', drums: 'Drums', melody: 'Melody' };

// Effective LFO frequency (Hz): 'free' uses its own rate; a tempo division derives from
// the detected BPM; an audio source scales the rate by that live envelope (0.1 Hz at
// silence → 0.1 + lfo.rate Hz at the peak). Audio sources need `live` = { kick, bands }.
export function effectiveRate(lfo, bpm, live) {
  if (!lfo.sync || lfo.sync === 'free') return lfo.rate;
  if (AUDIO_RATE_SOURCES[lfo.sync]) {
    const env = lfo.sync === 'kick' ? (live?.kick ?? 0) : (live?.bands?.[lfo.sync] ?? 0);
    return 0.1 + env * lfo.rate;
  }
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
    this.kick = 0; // 0..1 live kick-drum envelope while syncing
    this.lastBeatMs = 0; // performance.now() of the last detected beat (for the beat meter)
    this.phase = 'chorus'; // detected song phase: 'buildup' | 'drop' | 'chorus'
    // Spatial pattern: maps a design onto the flowers by their canvas position, so a
    // pattern flows across them in a direction. Move the flowers, the pattern stays.
    // direction in degrees; colorA/colorB + gradient drive the pattern's colors.
    // sync: 'free' (uses rate, cycles/sec) or a SYNC_DIVISIONS key (locks to BPM).
    this.pattern = { type: 'sweep', direction: 0, amount: 1, colorA: '#8b5cf6', colorB: '#22d3ee', gradient: false, sync: 'free', rate: 0.35 };
    this._patternOnce = false;
    this._onceLeft = 0;
    this.flowerPos = []; // global flower index -> { x, y } in 0..1 canvas space
    this.patternDrive = false; // when on, the pattern itself drives flower brightness
    this._patternPhase = 0;
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

  // global flower index -> { x, y } canvas position (reported by the visualization).
  setFlowerPositions(positions) { this.flowerPos = Array.isArray(positions) ? positions : []; }

  // Compute every flower's output, update the live state (viz), and optionally send.
  _emitOutput(doSend) {
    const F = Math.max(getFlowerCount() || this.flowerBouquet.length || 3, 1);
    const positions = [];
    for (let gi = 0; gi < F; gi += 1) positions.push(this.flowerPos[gi] || { x: gi / Math.max(1, F - 1), y: 0.5 });
    const patternOffsets = computePatternOffsets(this.pattern, positions);
    const cmds = [];
    const perFlower = [];
    if (this.patternDrive) {
      // The pattern itself drives brightness: a wave fades in/out across the flowers
      // by their position. With a gradient, the color blends between the two as it
      // flows (bright = colorB, dim = colorA).
      const A = this.pattern.colorA || '#8b5cf6';
      const B = this.pattern.colorB || A;
      const grad = !!(this.pattern.gradient && this.pattern.colorB);
      for (let gi = 0; gi < F; gi += 1) {
        const v = 0.5 + 0.5 * Math.sin(2 * Math.PI * (this._patternPhase - patternOffsets[gi]));
        const cmd = { br: String(Math.round(8 + v * 92)), co: grad ? mixHex(A, B, v) : A };
        cmds.push(cmd);
        const st = stateFromCommand(cmd);
        perFlower.push({ color: st.color, brightness: st.brightness });
      }
    } else {
      for (let gi = 0; gi < F; gi += 1) {
        const flowOff = patternOffsets[gi] || 0;
        const lvals = this.lfos.map((l) => {
          if (l.band && l.band !== 'none') return l.value;
          const off = l.stereo * (gi / F) + flowOff;
          return off > 0.0001 ? sampleCurve(l.points, (l.phase + off) % 1) : l.value;
        });
        const mvals = this._macroVals(lvals);
        const cmd = this._flowerCmd(gi, lvals, mvals);
        cmds.push(cmd);
        const st = stateFromCommand(cmd);
        perFlower.push({ color: st.color, brightness: st.brightness });
      }
    }
    const first = stateFromCommand(cmds[0] || {});
    setFlowerState({ ...first, perFlower });
    if (doSend) {
      // Low-latency binary frame (one write) when the board supports it; else JSON.
      if (hasFrameChannel()) sendFrame(cmds.map((c) => ({ br: Number(c.br), co: c.co })));
      else sendReactivePerFlower(cmds);
    }
  }

  // Apply the current (static) settings once — for manual changes while stopped.
  applyOnce() { this._emitOutput(true); }

  // Toggle the pattern driving the flowers directly. Keeps the loop alive on its own.
  setPatternDrive(on) {
    this.patternDrive = !!on;
    this._patternOnce = false;
    if (this.patternDrive && !this._raf) {
      this._last = performance.now();
      this._tick();
    } else if (!this.patternDrive && !this.running && this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
      this._emitOutput(true);
      this.emit();
    }
  }

  // Play the pattern through once (one full pass across the flowers), then go dark.
  triggerOnce() {
    this._patternPhase = 0;
    this._onceLeft = 1 + (this.pattern.amount || 0) + 0.6;
    this._patternOnce = true;
    this.patternDrive = true;
    if (!this._raf) { this._last = performance.now(); this._tick(); }
  }

  // Turn every flower off (used at the end of a one-shot trigger).
  _allOff() {
    const F = Math.max(getFlowerCount() || this.flowerBouquet.length || 3, 1);
    const cmds = [];
    const perFlower = [];
    for (let gi = 0; gi < F; gi += 1) { cmds.push({ br: '0' }); perFlower.push({ color: this.pattern.colorA, brightness: 0 }); }
    setFlowerState({ brightness: 0, color: this.pattern.colorA, perFlower });
    sendReactivePerFlower(cmds);
  }

  _tick = () => {
    if (!this.running && !this.patternDrive) return;
    this._raf = requestAnimationFrame(this._tick);
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;
    const prate = effectiveRate(this.pattern, this.bpm);
    this._patternPhase = (this._patternPhase + dt * prate) % 1;
    if (this._patternOnce) {
      this._onceLeft -= dt * prate;
      if (this._onceLeft <= 0) {
        this._patternOnce = false;
        this.patternDrive = false;
        this._allOff();
        if (!this.running && this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        this.emit();
      }
    }

    // Advance + sample each LFO per its mode, with onset delay.
    const live = { kick: this.kick, bands: this.bands };
    for (const lfo of this.lfos) {
      const freq = effectiveRate(lfo, this.bpm, live);
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
