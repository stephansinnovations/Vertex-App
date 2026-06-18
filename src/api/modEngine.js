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
import { sendReactive } from './flowerBle';
import { hsvToHex } from './audioReactive';

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

class ModEngine {
  constructor() {
    this.lfos = [0, 1, 2, 3].map((i) => ({
      name: `LFO ${i + 1}`,
      points: clonePoints(PRESETS.Triangle),
      preset: 'Triangle',
      rate: 0.5, // Hz
      smooth: 0, // 0..1
      phase: 0,
      value: 0,
      _smoothed: 0,
    }));
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
    this._last = performance.now();
    this._tick();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.emit();
  }

  _tick = () => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;

    // Advance + sample LFOs.
    for (const lfo of this.lfos) {
      lfo.phase = (lfo.phase + dt * lfo.rate) % 1;
      const raw = sampleCurve(lfo.points, lfo.phase);
      if (lfo.smooth > 0) {
        const coeff = Math.exp(-dt / (0.015 + lfo.smooth * 0.6));
        lfo._smoothed = lfo._smoothed * coeff + raw * (1 - coeff);
        lfo.value = lfo._smoothed;
      } else {
        lfo.value = raw;
        lfo._smoothed = raw;
      }
    }

    // Macros: base + routed LFO.
    for (const m of this.macros) {
      let v = m.base;
      const s = this._resolve(m.source);
      if (s != null) v += s * m.amount;
      m.value = Math.max(0, Math.min(1, v));
    }

    // Parameters.
    const cmd = {};
    const bSrc = this._resolve(this.params.brightness.source);
    if (bSrc != null) {
      const { min, max } = this.params.brightness;
      cmd.br = String(Math.round(min + (max - min) * bSrc));
    }
    const cSrc = this._resolve(this.params.color.source);
    if (cSrc != null) {
      const { min, max } = this.params.color;
      cmd.co = hsvToHex(min + (max - min) * cSrc, 1, 1);
    }
    const sSrc = this._resolve(this.params.speed.source);
    if (sSrc != null) {
      const { min, max } = this.params.speed;
      cmd.sp = String(Math.round(min + (max - min) * sSrc));
    }

    if (Object.keys(cmd).length) {
      setFlowerState(stateFromCommand(cmd)); // instant for the visualization
      if (now - this._lastSend > 70) { this._lastSend = now; sendReactive(cmd); }
    }

    // Throttle UI notifications to ~20fps.
    this._emitCounter += 1;
    if (this._emitCounter % 3 === 0) this.emit();
  };
}

export const modEngine = new ModEngine();
