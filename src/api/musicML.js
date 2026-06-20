// On-device learning for the Music App.
//
// Everything here runs entirely in the browser and stores only a tiny model summary
// in localStorage — no audio, no song titles, nothing leaves the device. It's
// unsupervised *online* learning (it adapts frame-by-frame, no training step), and it
// gets better the more music it hears. Two learners:
//
//   1. KickModel    — adaptive onset detection. Instead of fixed thresholds it learns
//      the running statistics of the sub-bass onset signal, so it locks onto the kick
//      of any track regardless of how loud/quiet or boomy it is.
//
//   2. PhaseLearner — streaming clustering (DP-means style). It groups the song into
//      recurring "sections" by their sound, and *grows a new category* when it hears
//      something that doesn't fit any it knows yet. So the longer it listens, the more
//      song parts it can tell apart (Intro / Build-up / Drop / Chorus / Verse / …).

const LS_KEY = 'musicMLModel.v1';

function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }

let _t = null;
// Debounced single write so rapid frames don't hammer localStorage.
function persist() {
  try {
    clearTimeout(_t);
    _t = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ kick: kickModel.toJSON(), phase: phaseLearner.toJSON() })); } catch { /* full/disabled */ }
    }, 1000);
  } catch { /* ignore */ }
}

// --- Kick detector -------------------------------------------------------------
export class KickModel {
  constructor(s = {}) {
    this.mean = s.mean ?? 0.015; // running mean of the sub-bass onset signal
    this.var = s.var ?? 0.0006;  // running variance (for an adaptive threshold)
    this.k = s.k ?? 1.7;         // threshold height in std-devs
    this.peak = s.peak ?? 0.3;   // typical kick energy (learned)
    this.hits = s.hits ?? 0;     // lifetime kicks learned from
  }

  // onset: positive sub-bass spectral flux (~0..1); energy: sub-bass band energy
  // (0..1); dtOk: debounce gate. Returns { hit, conf } and learns from the frame.
  update(onset, energy, dtOk) {
    const a = 0.02;
    const d = onset - this.mean;
    this.mean += a * d;
    this.var = (1 - a) * (this.var + a * d * d);
    const std = Math.sqrt(this.var) || 1e-3;
    const thresh = this.mean + this.k * std;
    const conf = Math.max(0, Math.min(1, (onset - this.mean) / Math.max(1e-4, thresh - this.mean)));
    let hit = false;
    if (dtOk && onset > thresh && energy > Math.max(0.06, this.peak * 0.35)) {
      hit = true;
      this.peak += 0.04 * (energy - this.peak); // learn the typical kick energy
      this.hits += 1;
      persist();
    }
    return { hit, conf };
  }

  toJSON() { return { mean: this.mean, var: this.var, k: this.k, peak: this.peak, hits: this.hits }; }
}

// --- Song-section learner ------------------------------------------------------
function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i += 1) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

// Map a cluster's feature signature → a human section name. Features are
// [bass, perc, mel, kick, level], each ~0..1 (level is the loudness, scaled up at
// storage time so it shares the bands' range).
function baseLabel(c) {
  const [bass, perc, mel, kick, level] = c;
  if (level < 0.18 && bass < 0.3) return 'Intro';
  if (level < 0.35 && kick < 0.25) return 'Breakdown';
  if (bass < 0.32 && kick < 0.3 && perc > 0.4) return 'Build-up';
  if (bass > 0.55 && kick > 0.55) return 'Drop';
  if (level > 0.5 && mel > 0.4) return 'Chorus';
  if (level > 0.35) return 'Verse';
  return 'Groove';
}

export class PhaseLearner {
  constructor(s = {}) {
    this.clusters = (s.clusters || []).map((cl) => ({ c: cl.c.slice(), n: cl.n }));
    this.maxClusters = s.maxClusters ?? 8;
    this.lambda = s.lambda ?? 0.22; // distance beyond which a new section is born
    this.current = -1;
    this._pending = -1;
    this._pendingN = 0;
    this.label = 'Chorus';
  }

  // Reset only the transient "which section are we in" state (keeps what it learned).
  beginSession() { this.current = -1; this._pending = -1; this._pendingN = 0; }

  // feat: { bass, perc, mel, kick, level } each ~0..1. Returns the current label.
  push(feat) {
    const f = [feat.bass || 0, feat.perc || 0, feat.mel || 0, feat.kick || 0, Math.min(1, (feat.level || 0) * 3)];
    let best = -1; let bestD = Infinity;
    for (let i = 0; i < this.clusters.length; i += 1) { const d = dist(f, this.clusters[i].c); if (d < bestD) { bestD = d; best = i; } }
    let idx;
    if (best === -1 || (bestD > this.lambda && this.clusters.length < this.maxClusters)) {
      this.clusters.push({ c: f.slice(), n: 1 }); // a section it hasn't heard before
      idx = this.clusters.length - 1;
    } else {
      idx = best;
      const cl = this.clusters[idx];
      cl.n += 1;
      const lr = Math.max(0.004, 1 / Math.min(cl.n, 600)); // decaying online mean
      for (let k = 0; k < f.length; k += 1) cl.c[k] += lr * (f[k] - cl.c[k]);
    }
    // Temporal smoothing so the section tag doesn't flicker between frames.
    if (idx === this.current) { this._pendingN = 0; }
    else if (idx === this._pending) { this._pendingN += 1; if (this._pendingN >= 5) { this.current = idx; this._pendingN = 0; } }
    else { this._pending = idx; this._pendingN = 1; }
    this.label = this._labelOf(this.current >= 0 ? this.current : idx);
    persist();
    return this.label;
  }

  // Human label for cluster i; disambiguated when several share a base name
  // (e.g. two distinct chorus-like sections → "Chorus 1" / "Chorus 2").
  _labelOf(i) {
    if (i < 0 || !this.clusters[i]) return 'Chorus';
    const base = baseLabel(this.clusters[i].c);
    let seen = 0; let rank = 0;
    for (let j = 0; j < this.clusters.length; j += 1) {
      if (baseLabel(this.clusters[j].c) === base) { seen += 1; if (j === i) rank = seen; }
    }
    return seen > 1 ? `${base} ${rank}` : base;
  }

  get count() { return this.clusters.length; }
  toJSON() { return { clusters: this.clusters, maxClusters: this.maxClusters, lambda: this.lambda }; }
}

const _saved = load();
export const kickModel = new KickModel(_saved.kick);
export const phaseLearner = new PhaseLearner(_saved.phase);

// Forget everything learned (kick stats + discovered sections).
export function resetMusicModel() {
  Object.assign(kickModel, new KickModel());
  phaseLearner.clusters = [];
  phaseLearner.current = -1; phaseLearner._pending = -1; phaseLearner._pendingN = 0; phaseLearner.label = 'Chorus';
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// Color for a section label — known sections get fixed hues; learned/extra ones a
// stable hashed hue. Strips a trailing disambiguation number ("Chorus 2" → "Chorus").
const SECTION_COLORS = {
  Intro: '#6b7280', Breakdown: '#60a5fa', 'Build-up': '#ffd400',
  Drop: '#ff0040', Chorus: '#36d6c3', Verse: '#a78bfa', Groove: '#22d3ee', Outro: '#9ca3af',
};
export function phaseColor(label) {
  const base = (label || '').replace(/\s+\d+$/, '');
  if (SECTION_COLORS[base]) return SECTION_COLORS[base];
  let h = 0; for (let i = 0; i < base.length; i += 1) h = (h * 31 + base.charCodeAt(i)) % 360;
  return `hsl(${h} 80% 62%)`;
}
