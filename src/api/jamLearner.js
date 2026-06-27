// Jam / call-and-response groove learner for the Music App.
//
// Records a human's pad performance, infers what each tap was "going for" from the live
// audio at tap time (the kick, the snare, or just the beat), then quantizes the whole
// sequence to the beat grid so the AI can replay it perfectly on-beat. This is a
// rhythm/quantize learner (classic onset classification + snapping), not an LLM.

export const TARGET_COLORS = { kick: '#ff6a00', snare: '#36d6c3', beat: '#a78bfa' };

// Classify what a tap was aiming at, from the live band levels at tap time (0..1).
export function classifyTarget({ kick = 0, snare = 0 } = {}) {
  if (kick >= 0.45 && kick >= snare) return 'kick';
  if (snare >= 0.4) return 'snare';
  return 'beat';
}

// Tally the targets → the dominant one (what the human was mostly going for).
export function summarize(hits) {
  const counts = { kick: 0, snare: 0, beat: 0 };
  hits.forEach((h) => { counts[h.target] = (counts[h.target] || 0) + 1; });
  let top = null; let best = 0;
  for (const k of Object.keys(counts)) { if (counts[k] > best) { best = counts[k]; top = k; } }
  return { counts, top: best ? top : null, total: hits.length };
}

// Quantize recorded hits (each with `tMs` relative to the record start) onto the beat
// grid. `grid` = subdivisions per beat (2 = eighth notes). Returns
// { events: [{ beatPos, effect, target }], loopBeats } where beatPos is in beats from
// the loop start. The loop is rounded up to whole 4-beat bars.
export function quantize(hits, bpm, grid = 2) {
  if (!hits || !hits.length) return { events: [], loopBeats: 4 };
  const beatMs = 60000 / Math.max(1, bpm);
  const t0 = hits[0].tMs;
  const raw = hits.map((h) => (h.tMs - t0) / beatMs); // beats from the first hit
  const span = raw[raw.length - 1] || 0;
  const loopBeats = Math.max(4, Math.ceil((span + 0.25) / 4) * 4);
  const events = hits.map((h, i) => ({
    beatPos: (((Math.round(raw[i] * grid) / grid) % loopBeats) + loopBeats) % loopBeats,
    effect: h.effect,
    target: h.target,
  }));
  return { events, loopBeats };
}

// Which events fall in the loop window (prev, cur] (in beats), handling wrap-around at
// the loop boundary. Used by the AI scheduler each animation frame.
export function dueEvents(events, prev, cur) {
  if (cur >= prev) return events.filter((e) => e.beatPos > prev && e.beatPos <= cur);
  return events.filter((e) => e.beatPos > prev || e.beatPos <= cur);
}
