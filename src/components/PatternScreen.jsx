import React, { useEffect, useRef, useReducer, useState, useMemo } from 'react';
import { Play, Square, Zap } from 'lucide-react';
import { modEngine, PATTERN_TYPES, computePatternOffsets, mixHex, SYNC_NAMES } from '@/api/modEngine';

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
  const [mode, setMode] = useState('pattern'); // 'pattern' | 'oneshot'
  const [pads, setPads] = useState(loadPads);
  const [activePad, setActivePad] = useState(-1);
  const dialRef = useRef(null);
  const draggingDir = useRef(false);
  const canvasRef = useRef(null);

  const p = modEngine.pattern;
  const dirEnabled = p.type !== 'radiate' && p.type !== 'scatter';
  const rad = (p.direction * Math.PI) / 180;
  const playing = modEngine.patternDrive;
  const synced = p.sync !== 'free';

  // Snapshot the current working pattern (what gets saved to a pad).
  const snapshot = () => ({
    type: p.type, direction: p.direction, amount: p.amount,
    colorA: p.colorA, colorB: p.colorB, gradient: p.gradient, sync: p.sync, rate: p.rate,
  });

  const setType = (type) => { modEngine.pattern.type = type; if (!modEngine.pattern.amount) modEngine.pattern.amount = 1; modEngine.applyOnce(); bump(); };
  const setAmount = (a) => { modEngine.pattern.amount = a; modEngine.applyOnce(); bump(); };
  const togglePlay = () => { modEngine.setPatternDrive(!modEngine.patternDrive); bump(); };
  const triggerOneShot = () => { modEngine.oneShot(snapshot(), 1); bump(); };
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
      const prate = (pat.sync && pat.sync !== 'free') ? 0.35 : Math.max(0.08, pat.rate || 0.35);
      phase = (phase + dt * prate) % 1;
      const ctx = canvasRef.current && canvasRef.current.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const offs = computePatternOffsets({ ...pat, amount: pat.amount || 1 }, gridPositions);
      const A = pat.colorA || '#8b5cf6';
      const B = pat.colorB || A;
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
    const move = (e) => { if (draggingDir.current) dirFromEvent(e); };
    const up = () => { draggingDir.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  return (
    <div className="rounded-2xl bg-[#0f1216] border border-white/8 p-3 flex flex-col gap-3">
      {/* Tabs + transport */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-0.5 rounded-full bg-white/5">
          {[['pattern', 'Pattern'], ['oneshot', 'One-shot']].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${mode === m ? 'bg-white text-black' : 'text-white/50 hover:text-white/80'}`}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'pattern' ? (
          <button onClick={togglePlay} title="Loop this pattern on the bouquets"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition ${playing ? 'bg-[#36d6c3] text-black' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}>
            {playing ? <><Square className="w-3 h-3" fill="currentColor" /> Stop</> : <><Play className="w-3 h-3" fill="currentColor" /> Play</>}
          </button>
        ) : (
          <button onClick={triggerOneShot} title="Fire the current pattern once (~1s)"
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/80 hover:bg-white/20 transition">
            <Zap className="w-3 h-3" /> Fire
          </button>
        )}
      </div>

      {/* Dense live preview + direction dial */}
      <div className="flex items-center gap-3">
        <canvas ref={canvasRef} width={600} height={260} className="flex-1 w-full rounded-lg" style={{ background: '#171a20' }} />
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

      {/* Finger pad — empty slots you save patterns to */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Finger pad</span>
          <span className="text-[9px] text-white/30">{mode === 'oneshot' ? 'tap = 1s burst' : 'tap = play'} · tap + to save</span>
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
          <button onClick={cycleDivision} title="Click to change the division" className="self-start px-2.5 py-1 rounded bg-black/30 text-[11px] text-white/85 border border-white/10">
            {p.sync} @ {modEngine.bpm} BPM
          </button>
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
          <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer select-none">
            <input type="checkbox" checked={!!p.gradient} onChange={(e) => setGradient(e.target.checked)} style={{ accentColor: '#36d6c3' }} /> Blend two
          </label>
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
