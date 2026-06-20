import React, { useEffect, useRef, useReducer, useState } from 'react';
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

// Finger pad: 2 rows × 8 = 16 preset pads. Tapping a pad loads its pattern preset
// (type / colors / direction / spread / speed) AND fires a one-shot ripple from the
// center outward — a launch-pad "hit".
const PAD_PRESETS = [
  { type: 'sweep', direction: 0, amount: 1.3, colorA: '#ff0040', colorB: '#ff7a00' },
  { type: 'sweep', direction: 45, amount: 1.3, colorA: '#ff7a00', colorB: '#ffd400' },
  { type: 'ripple', direction: 0, amount: 1.3, colorA: '#ffd400', colorB: '#00e676' },
  { type: 'bounce', direction: 90, amount: 1.3, colorA: '#00e676', colorB: '#00b8ff' },
  { type: 'radiate', direction: 0, amount: 1.4, colorA: '#00b8ff', colorB: '#6d28d9' },
  { type: 'scatter', direction: 0, amount: 1.4, colorA: '#8b5cf6', colorB: '#ff00d4' },
  { type: 'sweep', direction: 180, amount: 1.3, colorA: '#ff00d4', colorB: '#ff0040' },
  { type: 'bounce', direction: 45, amount: 1.3, colorA: '#f472b6', colorB: '#fb923c' },
  { type: 'ripple', direction: 0, amount: 1.3, colorA: '#22d3ee', colorB: '#36d6c3' },
  { type: 'radiate', direction: 0, amount: 1.4, colorA: '#ef4444', colorB: '#a855f7' },
  { type: 'sweep', direction: 270, amount: 1.3, colorA: '#3b82f6', colorB: '#2dd4bf' },
  { type: 'scatter', direction: 0, amount: 1.4, colorA: '#d946ef', colorB: '#fbbf24' },
  { type: 'ripple', direction: 0, amount: 1.3, colorA: '#22c55e', colorB: '#3b82f6' },
  { type: 'bounce', direction: 135, amount: 1.3, colorA: '#f59e0b', colorB: '#ef4444' },
  { type: 'sweep', direction: 315, amount: 1.3, colorA: '#06b6d4', colorB: '#8b5cf6' },
  { type: 'radiate', direction: 0, amount: 1.4, colorA: '#ffffff', colorB: '#36d6c3' },
].map((p) => ({ ...p, gradient: true, sync: 'free', rate: 0.5 }));

const PAD_ABBR = { sweep: 'SWP', ripple: 'RIP', bounce: 'BNC', radiate: 'RAD', scatter: 'SCT' };

// Preview grid (5×3 dots in 0..1 space).
const GRID = [];
for (let r = 0; r < 3; r += 1) for (let c = 0; c < 5; c += 1) GRID.push({ x: c / 4, y: r / 2 });

// The separate "pattern screen": shows the pattern type + direction as a live
// animated preview, independent of where the flowers actually are. Whatever you set
// here is mapped onto the flowers by their canvas position.
export default function PatternScreen() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const [activePad, setActivePad] = useState(-1);
  const phaseRef = useRef(0);
  const dialRef = useRef(null);
  const draggingDir = useRef(false);

  // Tap a pad → load its preset into the pattern + fire a ripple from the center out.
  const pressPad = (pad, idx) => {
    Object.assign(modEngine.pattern, {
      type: pad.type, direction: pad.direction, amount: pad.amount,
      colorA: pad.colorA, colorB: pad.colorB, gradient: pad.gradient,
      sync: pad.sync, rate: pad.rate,
    });
    modEngine.rippleBurst(pad.colorA, pad.gradient ? pad.colorB : null);
    setActivePad(idx);
    bump();
  };

  // Animate the preview phase.
  useEffect(() => {
    let raf;
    let last = performance.now();
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      phaseRef.current = (phaseRef.current + dt * 0.35) % 1;
      bump();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const p = modEngine.pattern;
  const dirEnabled = p.type !== 'radiate' && p.type !== 'scatter';
  const offsets = computePatternOffsets({ ...p, amount: p.amount || 1 }, GRID);
  const phase = phaseRef.current;
  const rad = (p.direction * Math.PI) / 180;

  const setType = (type) => { modEngine.pattern.type = type; if (!modEngine.pattern.amount) modEngine.pattern.amount = 1; modEngine.applyOnce(); bump(); };
  const setAmount = (a) => { modEngine.pattern.amount = a; modEngine.applyOnce(); bump(); };
  const togglePlay = () => { modEngine.setPatternDrive(!modEngine.patternDrive); bump(); };
  const playing = modEngine.patternDrive;
  const setColorA = (c) => { modEngine.pattern.colorA = c; modEngine.applyOnce(); bump(); };
  const setColorB = (c) => { modEngine.pattern.colorB = c; modEngine.applyOnce(); bump(); };
  const setGradient = (on) => { modEngine.pattern.gradient = on; modEngine.applyOnce(); bump(); };
  const setPair = (a, b) => { modEngine.pattern.colorA = a; modEngine.pattern.colorB = b; modEngine.pattern.gradient = true; modEngine.applyOnce(); bump(); };
  const triggerOnce = () => { modEngine.triggerOnce(); bump(); };
  const synced = p.sync !== 'free';
  const toggleBpmSync = () => { modEngine.pattern.sync = synced ? 'free' : '1 bar'; bump(); };
  const cycleDivision = () => { const i = SYNC_NAMES.indexOf(p.sync); modEngine.pattern.sync = SYNC_NAMES[(i + 1) % SYNC_NAMES.length]; bump(); };
  const setRate = (r) => { modEngine.pattern.rate = r; bump(); };

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Pattern</span>
          <span className="text-[11px] text-[#36d6c3] capitalize">{p.type}{dirEnabled ? ` · ${p.direction}°` : ''}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={triggerOnce} title="Play the pattern through once" className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-white/10 text-white/80 hover:bg-white/20 transition">
            <Zap className="w-3 h-3" /> Trigger
          </button>
          <button
            onClick={togglePlay}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition ${playing ? 'bg-[#36d6c3] text-black' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
            title="Play this pattern on the bouquets"
          >
            {playing ? <><Square className="w-3 h-3" fill="currentColor" /> Stop</> : <><Play className="w-3 h-3" fill="currentColor" /> Play</>}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Live preview */}
        <svg viewBox="0 0 200 120" className="flex-1 rounded-lg" style={{ background: '#171a20' }}>
          {GRID.map((g, i) => {
            const x = 16 + g.x * 168;
            const y = 16 + g.y * 88;
            const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * (phase - offsets[i]));
            const fill = (p.gradient && p.colorB) ? mixHex(p.colorA, p.colorB, w) : p.colorA;
            return <circle key={i} cx={x} cy={y} r={6} fill={fill} opacity={0.12 + 0.88 * w} />;
          })}
        </svg>

        {/* Direction dial */}
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

      {/* Finger pad — 2 rows × 8. Tap loads the preset + ripples from the center out. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-white/40">Finger pad</span>
        <div className="grid grid-cols-8 gap-1 touch-none select-none">
          {PAD_PRESETS.map((pad, i) => (
            <button
              key={i}
              onClick={() => pressPad(pad, i)}
              title={`${pad.type} · ripple from center`}
              className={`relative aspect-square rounded-md overflow-hidden transition-transform active:scale-90 ${activePad === i ? 'ring-2 ring-white scale-105' : 'ring-1 ring-white/10 hover:ring-white/30'}`}
              style={{ background: `linear-gradient(135deg, ${pad.colorA}, ${pad.colorB})`, boxShadow: activePad === i ? `0 0 12px ${pad.colorA}` : 'none' }}
            >
              <span className="absolute inset-x-0 bottom-0 text-center text-[7px] font-bold leading-[1.4] text-white/90 bg-black/30">{PAD_ABBR[pad.type]}</span>
            </button>
          ))}
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
