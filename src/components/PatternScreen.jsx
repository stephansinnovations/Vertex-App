import React, { useEffect, useRef, useReducer, useState, useMemo } from 'react';
import { Play, Square, Zap, Circle, Bot, Trash2 } from 'lucide-react';
import { modEngine, PATTERN_TYPES, computePatternOffsets, mixHex, rotateHex, SYNC_NAMES, effectiveRate } from '@/api/modEngine';
import { classifyTarget, summarize, quantize, dueEvents, TARGET_COLORS } from '@/api/jamLearner';
import Knob from '@/components/Knob';

// Two-color pairs that blend nicely.
const COLOR_PAIRS = [
  ['#8b5cf6', '#22d3ee'],
  ['#ec4899', '#fb923c'],
  ['#3b82f6', '#2dd4bf'],
  ['#d946ef', '#fbbf24'],
  ['#22c55e', '#3b82f6'],
  ['#ef4444', '#a855f7'],
];

const PAD_ABBR = { sweep: 'SWP', ripple: 'RIP', bounce: 'BNC', radiate: 'RAD', scatter: 'SCT' };

// User-saved finger pads — empty by default. Persisted across reloads.
const PAD_COUNT = 16;
const PADS_KEY = 'musicPads.v1';
function loadPads() {
  try {
    const a = JSON.parse(localStorage.getItem(PADS_KEY));
    if (Array.isArray(a)) { const out = a.slice(0, PAD_COUNT); while (out.length < PAD_COUNT) out.push(null); return out; }
  } catch { /* ignore */ }
  return Array(PAD_COUNT).fill(null);
}
function persistPads(pads) { try { localStorage.setItem(PADS_KEY, JSON.stringify(pads)); } catch { /* ignore */ } }

// Dense preview matrix (drawn on a canvas so we can afford ~1.8k dots).
const COLS = 64;
const ROWS = 28;

// The pattern screen: a live animated preview of the current pattern + the controls to
// shape it, plus one finger pad of save slots. A Pattern / One-shot tab switches what a
// saved pad does when tapped (loop it vs fire a ~1 s burst); the pads themselves don't
// change between tabs.
export default function PatternScreen() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const [mode, setMode] = useState('pattern'); // 'pattern' | 'oneshot' | 'jam'
  const [pads, setPads] = useState(loadPads);
  const [activePad, setActivePad] = useState(-1);
  const [flashType, setFlashType] = useState(''); // one-shot button just pressed
  // Jam (call-and-response): record the human's taps, learn the target, AI replays it on-beat.
  const [recording, setRecording] = useState(false);
  const [hits, setHits] = useState([]);
  const [aiPlaying, setAiPlaying] = useState(false);
  const recStartRef = useRef(0);
  const hitsRef = useRef([]);
  const quantRef = useRef(null);
  const aiStartRef = useRef(0);
  const aiPrevRef = useRef(0);
  hitsRef.current = hits;
  const jamSummary = summarize(hits);
  const dialRef = useRef(null);
  const draggingDir = useRef(false);
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const viewDragRef = useRef(null);

  const p = modEngine.pattern;
  const dirEnabled = p.type !== 'radiate' && p.type !== 'scatter';
  const rad = (p.direction * Math.PI) / 180;
  const playing = modEngine.patternDrive;
  const synced = p.sync !== 'free';
  const view = p.view || { x: 0, y: 0, w: 1, h: 1 };

  // Capture window (the grid box over the pattern) — drag to move, corner to resize.
  // Flowers only play the slice inside it, so this zooms/pans into a spot of the pattern.
  const startViewDrag = (kind) => (e) => {
    e.stopPropagation();
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    viewDragRef.current = { kind, r, startX: e.clientX, startY: e.clientY, v: { ...view } };
  };
  const resetView = () => { modEngine.pattern.view = { x: 0, y: 0, w: 1, h: 1 }; modEngine.applyOnce(); bump(); };

  // Snapshot the current working pattern (what gets saved to a pad).
  const snapshot = () => ({
    type: p.type, direction: p.direction, amount: p.amount,
    colorA: p.colorA, colorB: p.colorB, gradient: p.gradient, sync: p.sync, rate: p.rate, colorSpeed: p.colorSpeed || 0,
  });

  const setType = (type) => { modEngine.pattern.type = type; if (!modEngine.pattern.amount) modEngine.pattern.amount = 1; modEngine.applyOnce(); bump(); };
  const setAmount = (a) => { modEngine.pattern.amount = a; modEngine.applyOnce(); bump(); };
  const togglePlay = () => { modEngine.setPatternDrive(!modEngine.patternDrive); bump(); };
  // One-shot tab keeps the selected pattern looping underneath, so the flowers aren't
  // dark between shots — a one-shot fires on top and falls back to this loop. We only
  // turn the loop on if it wasn't already running, and turn it back off on leaving.
  useEffect(() => {
    if (mode !== 'oneshot') return undefined;
    const wasDriving = modEngine.patternDrive;
    if (!wasDriving) { modEngine.setPatternDrive(true); bump(); }
    return () => { if (!wasDriving && !modEngine.running) { modEngine.setPatternDrive(false); } };
  }, [mode]);

  // One-shot tab: fire a single effect of the given type once (using the current colors,
  // direction and spread), then it goes dark — without changing the working pattern.
  // In Jam mode it also records the tap + what it was going for (kick/snare/beat).
  const fireType = (t) => {
    const effect = { ...snapshot(), type: t };
    modEngine.oneShot(effect, 1 + (p.amount || 0) * 0.35);
    setFlashType(t);
    setTimeout(() => setFlashType((cur) => (cur === t ? '' : cur)), 360);
    if (mode === 'jam' && recording) {
      const ctx = { kick: modEngine.kick || 0, snare: modEngine.bands?.drums || 0 };
      setHits((h) => [...h, { tMs: performance.now() - recStartRef.current, effect, ...ctx, target: classifyTarget(ctx) }]);
    }
    bump();
  };

  // Jam transport.
  const startRecord = () => { setAiPlaying(false); setHits([]); recStartRef.current = performance.now(); setRecording(true); };
  const stopRecord = () => setRecording(false);
  const aiStop = () => setAiPlaying(false);
  const aiPlay = () => {
    const q = quantize(hitsRef.current, modEngine.bpm || 120, 2);
    if (!q.events.length) return;
    quantRef.current = q;
    aiStartRef.current = modEngine.lastBeatMs || performance.now(); // anchor to a real beat
    aiPrevRef.current = -1e-4;
    setRecording(false);
    setAiPlaying(true);
  };
  const clearJam = () => { setAiPlaying(false); setRecording(false); setHits([]); };

  // AI scheduler: loop the quantized hits locked to the live BPM, firing each on-beat.
  useEffect(() => {
    if (!aiPlaying) return undefined;
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const q = quantRef.current;
      if (!q || !q.events.length) return;
      const beatMs = 60000 / (modEngine.bpm || 120);
      const cur = ((performance.now() - aiStartRef.current) / beatMs) % q.loopBeats;
      const due = dueEvents(q.events, aiPrevRef.current, cur);
      const dur = Math.max(0.25, (60 / (modEngine.bpm || 120)) * 0.5);
      due.forEach((e) => modEngine.oneShot({ ...e.effect }, dur));
      aiPrevRef.current = cur;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [aiPlaying]);
  const setColorSpeed = (v) => { modEngine.pattern.colorSpeed = v; modEngine.applyOnce(); bump(); };
  const setColorA = (c) => { modEngine.pattern.colorA = c; modEngine.applyOnce(); bump(); };
  const setColorB = (c) => { modEngine.pattern.colorB = c; modEngine.applyOnce(); bump(); };
  const setGradient = (on) => { modEngine.pattern.gradient = on; modEngine.applyOnce(); bump(); };
  const setPair = (a, b) => { modEngine.pattern.colorA = a; modEngine.pattern.colorB = b; modEngine.pattern.gradient = true; modEngine.applyOnce(); bump(); };
  const toggleBpmSync = () => { modEngine.pattern.sync = synced ? 'free' : '1 bar'; bump(); };
  const cycleDivision = () => { const i = SYNC_NAMES.indexOf(p.sync); modEngine.pattern.sync = SYNC_NAMES[(i + 1) % SYNC_NAMES.length]; bump(); };
  const setRate = (r) => { modEngine.pattern.rate = r; bump(); };

  // Tap a pad. Empty → save the current working pattern there. Saved → play it
  // (Pattern tab loops it; One-shot tab fires it as a ~1 s burst).
  const pressPad = (i) => {
    const pad = pads[i];
    setActivePad(i);
    if (!pad) {
      const next = pads.slice(); next[i] = snapshot(); setPads(next); persistPads(next);
      bump();
      return;
    }
    if (mode === 'oneshot') {
      modEngine.oneShot({ ...pad }, 1);
    } else {
      Object.assign(modEngine.pattern, pad);
      modEngine.setPatternDrive(true);
    }
    bump();
  };

  const clearPad = (i, e) => {
    e.stopPropagation();
    const next = pads.slice(); next[i] = null; setPads(next); persistPads(next);
    if (activePad === i) setActivePad(-1);
    bump();
  };

  // Dense dot matrix positions (0..1 space), computed once.
  const gridPositions = useMemo(() => {
    const g = [];
    for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
      g.push({ x: COLS > 1 ? c / (COLS - 1) : 0.5, y: ROWS > 1 ? r / (ROWS - 1) : 0.5 });
    }
    return g;
  }, []);

  // Animate the preview on a canvas (reads the live pattern each frame).
  useEffect(() => {
    let raf;
    let last = performance.now();
    let phase = 0;
    let colorPhase = 0;
    const cvs = canvasRef.current;
    const W = cvs ? cvs.width : 600;
    const H = cvs ? cvs.height : 260;
    const mx = 12;
    const my = 12;
    const dotR = Math.max(1, Math.min((W - 2 * mx) / COLS, (H - 2 * my) / ROWS) * 0.42);
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const pat = modEngine.pattern;
      // Animate at the SAME rate the flowers use: when synced this is the live
      // detected BPM (modEngine.bpm) / division, so the preview visibly locks to the song.
      const prate = Math.max(0.05, effectiveRate(pat, modEngine.bpm));
      phase = (phase + dt * prate) % 1;
      colorPhase = (colorPhase + dt * (pat.colorSpeed || 0) * 140) % 360;
      const ctx = canvasRef.current && canvasRef.current.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const offs = computePatternOffsets({ ...pat, amount: pat.amount || 1 }, gridPositions);
      const cp = pat.colorSpeed ? colorPhase : 0;
      const A = cp ? rotateHex(pat.colorA || '#8b5cf6', cp) : (pat.colorA || '#8b5cf6');
      const B = cp ? rotateHex(pat.colorB || pat.colorA || '#8b5cf6', cp) : (pat.colorB || pat.colorA || '#8b5cf6');
      const grad = !!(pat.gradient && pat.colorB);
      for (let i = 0; i < gridPositions.length; i += 1) {
        const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * (phase - offs[i]));
        const x = mx + gridPositions[i].x * (W - 2 * mx);
        const y = my + gridPositions[i].y * (H - 2 * my);
        ctx.globalAlpha = 0.08 + 0.92 * w;
        ctx.fillStyle = grad ? mixHex(A, B, w) : A;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, 6.283185);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [gridPositions]);

  const dirFromEvent = (e) => {
    if (!dialRef.current) return;
    const rect = dialRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
    modEngine.pattern.direction = Math.round((ang + 360) % 360);
    modEngine.applyOnce();
    bump();
  };

  useEffect(() => {
    const move = (e) => {
      if (draggingDir.current) { dirFromEvent(e); return; }
      const vd = viewDragRef.current;
      if (!vd) return;
      const dx = (e.clientX - vd.startX) / vd.r.width;
      const dy = (e.clientY - vd.startY) / vd.r.height;
      const v = modEngine.pattern.view || { x: 0, y: 0, w: 1, h: 1 };
      if (vd.kind === 'move') {
        v.x = Math.max(0, Math.min(1 - vd.v.w, vd.v.x + dx));
        v.y = Math.max(0, Math.min(1 - vd.v.h, vd.v.y + dy));
      } else {
        v.w = Math.max(0.08, Math.min(1 - vd.v.x, vd.v.w + dx));
        v.h = Math.max(0.08, Math.min(1 - vd.v.y, vd.v.h + dy));
      }
      modEngine.applyOnce();
      bump();
    };
    const up = () => { draggingDir.current = false; viewDragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  return (
    <div className="rounded-2xl bg-[#0f1216] border border-white/8 p-3 flex flex-col gap-3">
      {/* Tabs + transport */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-0.5 rounded-full bg-white/5">
          {[['pattern', 'Pattern'], ['oneshot', 'One-shot'], ['jam', 'Jam']].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${mode === m ? 'bg-white text-black' : 'text-white/50 hover:text-white/80'}`}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'pattern' && (
          <button onClick={togglePlay} title="Loop this pattern on the bouquets"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition ${playing ? 'bg-[#36d6c3] text-black' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}>
            {playing ? <><Square className="w-3 h-3" fill="currentColor" /> Stop</> : <><Play className="w-3 h-3" fill="currentColor" /> Play</>}
          </button>
        )}
        {mode === 'oneshot' && <span className="text-[10px] text-white/35 pr-1">tap an effect to fire it once</span>}
        {mode === 'jam' && <span className="text-[10px] text-white/35 pr-1">play it · then let the AI take over</span>}
      </div>

      {/* Dense live preview + direction dial */}
      <div className="flex items-center gap-3">
        <div ref={canvasWrapRef} className="relative flex-1 min-w-0">
          <canvas ref={canvasRef} width={600} height={260} className="w-full rounded-lg block" style={{ background: '#171a20' }} />
          {/* Capture window — the grid box the flowers play; drag to move, corner to resize */}
          <div
            onPointerDown={startViewDrag('move')}
            onDoubleClick={resetView}
            title="Drag to pan · corner to resize · double-click to reset — the flowers play the slice inside this box"
            className="absolute border-2 border-[#36d6c3]/90 rounded-sm cursor-move"
            style={{
              left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%`,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              backgroundImage: 'repeating-linear-gradient(0deg, rgba(54,214,195,0.22) 0 1px, transparent 1px 33.34%), repeating-linear-gradient(90deg, rgba(54,214,195,0.22) 0 1px, transparent 1px 33.34%)',
              backgroundSize: '100% 100%',
            }}
          >
            <div onPointerDown={startViewDrag('resize')} className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 rounded-sm bg-[#36d6c3] cursor-se-resize" title="Resize the capture window" />
          </div>
        </div>
        <div
          ref={dialRef}
          onPointerDown={(e) => { if (!dirEnabled) return; draggingDir.current = true; dirFromEvent(e); }}
          className={`relative w-16 h-16 rounded-full border flex-shrink-0 ${dirEnabled ? 'border-white/20 cursor-pointer' : 'border-white/5 opacity-40'}`}
          style={{ background: '#171a20' }}
          title="Drag to set the pattern direction"
        >
          <svg viewBox="0 0 64 64" className="w-full h-full">
            <circle cx="32" cy="32" r="3" fill="#36d6c3" />
            <line x1="32" y1="32" x2={32 + 24 * Math.cos(rad)} y2={32 + 24 * Math.sin(rad)} stroke="#36d6c3" strokeWidth="3" strokeLinecap="round" />
            <circle cx={32 + 24 * Math.cos(rad)} cy={32 + 24 * Math.sin(rad)} r="4" fill="#36d6c3" />
          </svg>
        </div>
      </div>

      {/* Jam tab: call-and-response — record your taps, AI replays them on-beat. */}
      {mode === 'jam' && (
        <div className="flex flex-col gap-2 rounded-xl bg-black/30 border border-white/8 p-2.5">
          <div className="flex items-center gap-2">
            {!recording ? (
              <button onClick={startRecord} disabled={aiPlaying}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#ff2d55] text-white hover:bg-[#ff2d55]/90 transition disabled:opacity-40">
                <Circle className="w-3 h-3" fill="currentColor" /> Record
              </button>
            ) : (
              <button onClick={stopRecord}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-black transition">
                <Square className="w-3 h-3" fill="currentColor" /> Stop &amp; learn
              </button>
            )}
            {!aiPlaying ? (
              <button onClick={aiPlay} disabled={recording || hits.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#36d6c3] text-black hover:bg-[#36d6c3]/90 transition disabled:opacity-40">
                <Bot className="w-3.5 h-3.5" /> AI takes over
              </button>
            ) : (
              <button onClick={aiStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-black transition">
                <Square className="w-3 h-3" fill="currentColor" /> Stop AI
              </button>
            )}
            {hits.length > 0 && !recording && !aiPlaying && (
              <button onClick={clearJam} title="Clear" className="ml-auto p-1.5 rounded-full text-white/40 hover:text-white/80 transition"><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
          {/* Status */}
          <span className="text-[11px] text-white/55">
            {recording ? 'Recording your moves — tap the effects to the music…'
              : aiPlaying ? 'AI is looping your groove, locked to the beat 🤖'
              : hits.length ? <>Learned {jamSummary.total} hit{jamSummary.total === 1 ? '' : 's'} — you were going for the <span style={{ color: TARGET_COLORS[jamSummary.top] }} className="font-semibold uppercase">{jamSummary.top}</span>. Hit “AI takes over”.</>
              : 'Record a groove on the pads below, then the AI replays it perfectly on-beat.'}
          </span>
          {/* Hit timeline — dots colored by what each tap was going for */}
          {hits.length > 0 && (
            <div className="relative h-6 rounded bg-white/5 overflow-hidden">
              {hits.map((h, i) => {
                const span = (hits[hits.length - 1].tMs - hits[0].tMs) || 1;
                const x = ((h.tMs - hits[0].tMs) / span) * 96 + 2;
                return <span key={i} className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ left: `${x}%`, background: TARGET_COLORS[h.target], boxShadow: `0 0 6px ${TARGET_COLORS[h.target]}` }} />;
              })}
            </div>
          )}
        </div>
      )}

      {/* One-shot + Jam: one button per effect — tap fires that effect once. */}
      {(mode === 'oneshot' || mode === 'jam') ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-white/40">{mode === 'jam' ? 'Your pads' : 'One-shots'}</span>
            <span className="text-[9px] text-white/30">{mode === 'jam' ? 'tap to play — recorded while armed' : 'tap = fire that effect once'}</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5 touch-none select-none">
            {PATTERN_TYPES.map((t) => (
              <button key={t} onClick={() => fireType(t)} title={`Fire a ${t} once`}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg text-[11px] capitalize font-semibold transition active:scale-90 ${flashType === t ? 'bg-[#36d6c3] text-black scale-105' : 'bg-white/8 text-white/75 hover:bg-white/15'}`}
                style={flashType === t ? { boxShadow: `0 0 14px ${p.colorA}` } : undefined}>
                <Zap className="w-3.5 h-3.5" />
                {t}
              </button>
            ))}
          </div>
        </div>
      ) : (
      /* Pattern tab: finger pad — empty slots you save patterns to */
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Finger pad</span>
          <span className="text-[9px] text-white/30">tap = play · tap + to save</span>
        </div>
        <div className="grid grid-cols-8 gap-1 touch-none select-none">
          {pads.map((pad, i) => (pad ? (
            <button key={i} onClick={() => pressPad(i)} title={`${pad.type} · ${mode === 'oneshot' ? 'one-shot' : 'play'}`}
              className={`relative aspect-square rounded-md overflow-hidden transition-transform active:scale-90 ${activePad === i ? 'ring-2 ring-white scale-105' : 'ring-1 ring-white/10 hover:ring-white/30'}`}
              style={{ background: `linear-gradient(135deg, ${pad.colorA}, ${pad.gradient && pad.colorB ? pad.colorB : pad.colorA})`, boxShadow: activePad === i ? `0 0 12px ${pad.colorA}` : 'none' }}>
              <span className="absolute inset-x-0 bottom-0 text-center text-[7px] font-bold leading-[1.4] text-white/90 bg-black/30">{PAD_ABBR[pad.type]}</span>
              <span role="button" tabIndex={-1} onClick={(e) => clearPad(i, e)} title="Clear pad"
                className="absolute top-0 right-0 w-3.5 h-3.5 flex items-center justify-center text-[9px] leading-none text-white/70 bg-black/45 rounded-bl hover:text-white">×</span>
            </button>
          ) : (
            <button key={i} onClick={() => pressPad(i)} title="Save the current pattern here"
              className="aspect-square rounded-md border border-dashed border-white/15 text-white/30 hover:border-white/40 hover:text-white/60 flex items-center justify-center transition active:scale-90">
              <span className="text-sm leading-none">+</span>
            </button>
          )))}
        </div>
      </div>
      )}

      {/* Pattern type */}
      <div className="flex flex-wrap gap-1.5">
        {PATTERN_TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`px-2.5 py-1 rounded-full text-xs capitalize transition ${p.type === t && p.amount ? 'bg-white text-black' : 'bg-white/5 text-white/60 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="flex justify-between text-[10px] uppercase tracking-wide text-white/40"><span>Spread</span><span className="text-white/60">{(p.amount || 0).toFixed(1)}</span></span>
        <input type="range" min="0" max="3" step="0.1" value={p.amount || 0} onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ accentColor: '#36d6c3', background: `linear-gradient(to right,#36d6c3 ${((p.amount || 0) / 3) * 100}%, rgba(255,255,255,0.12) ${((p.amount || 0) / 3) * 100}%)` }} />
      </label>

      {/* Speed / BPM sync */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-white/40">Speed</span>
          <button onClick={toggleBpmSync} className={`px-2 py-0.5 rounded-full text-[11px] transition ${synced ? 'bg-[#36d6c3] text-black' : 'bg-white/10 text-white/60 hover:text-white'}`}>Sync to BPM</button>
        </div>
        {synced ? (
          <div className="flex flex-col gap-0.5">
            <button onClick={cycleDivision} title="Click to change the division" className="self-start px-2.5 py-1 rounded bg-black/30 text-[11px] text-white/85 border border-white/10">
              {p.sync} @ {modEngine.bpm} BPM
            </button>
            <span className="text-[9px] text-white/35">
              {modEngine.detecting ? 'Following the live song from “Sync to music”.' : 'Start “Sync to music” up top to lock to the song’s tempo.'}
            </span>
          </div>
        ) : (
          <input type="range" min="0.05" max="2" step="0.05" value={p.rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: '#36d6c3', background: `linear-gradient(to right,#36d6c3 ${(p.rate / 2) * 100}%, rgba(255,255,255,0.12) ${(p.rate / 2) * 100}%)` }} />
        )}
      </div>

      {/* Colors */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-white/40">Colors</span>
          <div className="flex items-center gap-3">
            {/* Smoothly cycles the colors through the spectrum */}
            <div className="flex items-center gap-1.5">
              <Knob value={p.colorSpeed || 0} onChange={setColorSpeed} size={28} format={(v) => (v < 0.01 ? 'off' : `${Math.round(v * 100)}%`)} />
              <span className="text-[9px] uppercase tracking-wide text-white/40 leading-tight">Color<br />speed</span>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer select-none">
              <input type="checkbox" checked={!!p.gradient} onChange={(e) => setGradient(e.target.checked)} style={{ accentColor: '#36d6c3' }} /> Blend two
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PAIRS.map(([a, b]) => {
            const active = p.gradient && (p.colorA || '').toLowerCase() === a && (p.colorB || '').toLowerCase() === b;
            return (
              <button key={a + b} onClick={() => setPair(a, b)} title="Use this blend"
                className={`w-9 h-6 rounded-md transition ${active ? 'ring-2 ring-white/80' : 'ring-1 ring-white/10'}`}
                style={{ background: `linear-gradient(90deg, ${a}, ${b})` }} />
            );
          })}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-[11px] text-white/50 cursor-pointer">
            <span className="w-6 h-6 rounded-full overflow-hidden relative border border-white/15 block" style={{ background: p.colorA }}>
              <input type="color" value={p.colorA} onChange={(e) => setColorA(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </span>
            {p.gradient ? 'Color A' : 'Color'}
          </label>
          {p.gradient && (
            <label className="flex items-center gap-1.5 text-[11px] text-white/50 cursor-pointer">
              <span className="w-6 h-6 rounded-full overflow-hidden relative border border-white/15 block" style={{ background: p.colorB }}>
                <input type="color" value={p.colorB} onChange={(e) => setColorB(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
              </span>
              Color B
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
