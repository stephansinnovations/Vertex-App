import React, { useEffect, useRef, useReducer } from 'react';
import { modEngine, PATTERN_TYPES, computePatternOffsets } from '@/api/modEngine';

// Preview grid (5×3 dots in 0..1 space).
const GRID = [];
for (let r = 0; r < 3; r += 1) for (let c = 0; c < 5; c += 1) GRID.push({ x: c / 4, y: r / 2 });

// The separate "pattern screen": shows the pattern type + direction as a live
// animated preview, independent of where the flowers actually are. Whatever you set
// here is mapped onto the flowers by their canvas position.
export default function PatternScreen() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const phaseRef = useRef(0);
  const dialRef = useRef(null);
  const draggingDir = useRef(false);

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
        <span className="text-[10px] uppercase tracking-widest text-white/40">Pattern</span>
        <span className="text-[11px] text-[#36d6c3] capitalize">{p.type}{dirEnabled ? ` · ${p.direction}°` : ''}</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Live preview */}
        <svg viewBox="0 0 200 120" className="flex-1 rounded-lg" style={{ background: '#171a20' }}>
          {GRID.map((g, i) => {
            const x = 16 + g.x * 168;
            const y = 16 + g.y * 88;
            const v = 0.12 + 0.88 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (phase - offsets[i])));
            return <circle key={i} cx={x} cy={y} r={6} fill="#36d6c3" opacity={v} />;
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
    </div>
  );
}
