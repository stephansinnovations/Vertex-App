import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, ZapOff, Plus, Trash2, X, Check } from 'lucide-react';
import { isConnected, getFlowerCount, onStatus } from '@/api/flowerBle';
import { loadLayout, saveLayout, newBouquet, SHAPES } from '@/api/flowerLayout';
import { onFlowerState, getFlowerState } from '@/api/flowerState';

const HUES = [270, 190, 330, 45, 150, 0, 210, 300];
const hueFor = (i) => `hsl(${HUES[i % HUES.length]}, 85%, 62%)`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Each flower's canvas position (0..1) = bouquet position + its offset within the
// 124×108 cluster box, scaled by the canvas size. Drives the spatial pattern.
function computePositions(lay, canvasEl) {
  const rect = canvasEl ? canvasEl.getBoundingClientRect() : null;
  const W = (rect && rect.width) || 900;
  const H = (rect && rect.height) || 360;
  const positions = [];
  for (const b of lay.bouquets) {
    const n = b.flowers.length;
    b.flowers.forEach((f, fi) => {
      const ang = (-90 + (fi * 360) / n) * (Math.PI / 180);
      const fx = f.fx ?? (62 + 30 * Math.cos(ang));
      const fy = f.fy ?? (56 + 28 * Math.sin(ang));
      const px = (b.x ?? 0.5) * W + (fx - 62);
      const py = (b.y ?? 0.5) * H + (fy - 54);
      positions.push({ x: clamp01(px / W), y: clamp01(py / H) });
    });
  }
  return positions;
}

// One flower as a compact LED ring showing its live output. No labels.
function FlowerView({ flower, gi, connected, head, liveColor, brightness, isWave, selected, flashing }) {
  const n = Math.max(1, flower.ledCount);
  const color = flashing ? '#ffffff' : (connected ? (liveColor || hueFor(gi)) : hueFor(gi));
  const briF = connected ? Math.max(0, Math.min(1, (brightness ?? 100) / 100)) : 1;
  const cx = 70;
  const cy = 70;
  const R = 52;
  const tail = Math.max(3, Math.round(n / 3));
  const headIdx = head % n;
  const dots = [];
  for (let i = 0; i < n; i += 1) {
    let x;
    let y;
    if (flower.shape === 'line') {
      const margin = 12;
      const span = 140 - 2 * margin;
      x = margin + (n > 1 ? (i / (n - 1)) * span : span / 2);
      y = cy;
    } else {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      x = cx + R * Math.cos(a);
      y = cy + R * Math.sin(a);
    }
    const d = (headIdx - i + n) % n;
    const comet = d < tail ? 1 - d / tail : 0;
    let op;
    let r;
    if (flashing) { op = 1; r = 5.5; }
    else if (!connected) { op = 0.1 + 0.1 * comet; r = 3.1 + 1.8 * comet; }
    else if (isWave) { op = Math.max(0.08, (0.12 + 0.88 * comet) * briF); r = 3.1 + 2.3 * comet; }
    else { op = Math.max(0.08, briF); r = 4.2; }
    dots.push(<circle key={i} cx={x} cy={y} r={r} fill={color} opacity={op}
      style={(flashing || (connected && (isWave ? comet > 0.45 : briF > 0.5))) ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined} />);
  }
  return (
    <div className={`relative rounded-full transition-shadow ${flashing ? 'ring-4 ring-white' : (selected ? 'ring-2 ring-white/80' : '')}`}>
      <svg viewBox="0 0 140 140" className="w-12 h-12">{dots}</svg>
    </div>
  );
}

// Free-form canvas: bouquets are triangle clusters of 3 flowers you can drag
// anywhere. Each flower's position drives the spatial pattern. Single-click selects
// (for the settings panel), double-click a flower edits its wiring.
export default function BouquetVisualizer({ selected = 'all', onSelect, onLayout }) {
  const [layout, setLayout] = useState(null);
  const [live, setLive] = useState(getFlowerState());
  const [connected, setConnected] = useState(isConnected());
  const [flowerCount, setFlowerCount] = useState(getFlowerCount());
  const [head, setHead] = useState(0);
  const [editing, setEditing] = useState(null); // { bi, fi }
  const [draft, setDraft] = useState(null);
  const [flashGi, setFlashGi] = useState(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const layoutRef = useRef(null);
  const flashTimer = useRef(null);
  layoutRef.current = layout;

  // Briefly flash a flower white (visual click feedback / identify).
  const flashRef = useRef(() => {});
  flashRef.current = (gi) => {
    setFlashGi(gi);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashGi(null), 450);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // Report the layout + each flower's canvas position to the parent (engine wiring).
  const report = useCallback((lay) => { onLayout?.(lay, computePositions(lay, canvasRef.current)); }, [onLayout]);

  useEffect(() => { loadLayout().then((l) => { setLayout(l); setFlowerCount(getFlowerCount()); report(l); }); }, [report]);
  useEffect(() => onFlowerState(setLive), []);
  useEffect(() => {
    const sync = () => { setConnected(isConnected()); setFlowerCount(getFlowerCount()); };
    sync();
    return onStatus(sync);
  }, []);
  useEffect(() => { const id = setInterval(() => setHead((h) => h + 1), 90); return () => clearInterval(id); }, []);

  // Global start index per bouquet.
  const starts = [];
  if (layout) { let acc = 0; for (const b of layout.bouquets) { starts.push(acc); acc += b.flowers.length; } }
  const startsRef = useRef(starts);
  startsRef.current = starts;

  // Drag handling (pointer on a cluster moves the whole bouquet; a click selects).
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && (Math.abs(e.clientX - d.startX) > 4 || Math.abs(e.clientY - d.startY) > 4)) d.moved = true;
      if (!d.moved) return;
      if (d.fi != null && d.clusterEl) {
        // Drag a single flower within its bouquet cluster.
        const cr = d.clusterEl.getBoundingClientRect();
        const fx = Math.max(10, Math.min(114, e.clientX - cr.left));
        const fy = Math.max(10, Math.min(98, e.clientY - cr.top));
        setLayout((prev) => {
          const next = {
            ...prev,
            bouquets: prev.bouquets.map((bb, i) => (i !== d.bi ? bb : {
              ...bb, flowers: bb.flowers.map((f, j) => (j === d.fi ? { ...f, fx, fy } : f)),
            })),
          };
          report(next);
          return next;
        });
      } else if (canvasRef.current) {
        // Drag the whole bouquet around the canvas.
        const rect = canvasRef.current.getBoundingClientRect();
        const x = clamp01((e.clientX - rect.left) / rect.width);
        const y = clamp01((e.clientY - rect.top) / rect.height);
        setLayout((prev) => {
          const next = { ...prev, bouquets: prev.bouquets.map((bb, i) => (i === d.bi ? { ...bb, x, y } : bb)) };
          report(next);
          return next;
        });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      if (d.moved) { saveLayout(layoutRef.current); }
      else if (d.fi != null) { const gi = startsRef.current[d.bi] + d.fi; onSelect?.(`f${gi}`); flashRef.current(gi); }
      else { onSelect?.(`b${d.bi}`); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [report, onSelect]);

  if (!layout) return null;
  const isWave = Array.isArray(live.motion) && live.motion.includes('wave');

  const persist = (next) => { setLayout(next); saveLayout(next); report(next); };
  const openEdit = (bi, fi) => { setDraft({ ...layout.bouquets[bi].flowers[fi] }); setEditing({ bi, fi }); };
  const closeEdit = () => { setEditing(null); setDraft(null); };
  const saveEdit = () => {
    const { bi, fi } = editing;
    persist({ ...layout, bouquets: layout.bouquets.map((b, i) => (i !== bi ? b : { ...b, flowers: b.flowers.map((f, j) => (j === fi ? draft : f)) })) });
    closeEdit();
  };
  const removeFlower = () => {
    const { bi, fi } = editing;
    persist({ ...layout, bouquets: layout.bouquets.map((b, i) => (i !== bi ? b : { ...b, flowers: b.flowers.filter((_, j) => j !== fi) })).filter((b) => b.flowers.length) });
    closeEdit();
  };
  const addBouquet = () => persist({ ...layout, bouquets: [...layout.bouquets, newBouquet(layout.bouquets.length)] });
  const removeBouquet = (bi) => persist({ ...layout, bouquets: layout.bouquets.filter((_, i) => i !== bi) });

  const startDrag = (e, bi) => {
    const fiEl = e.target.closest('[data-fi]');
    const fi = fiEl ? Number(fiEl.dataset.fi) : null;
    const clusterEl = fiEl ? fiEl.closest('[data-cluster]') : null;
    dragRef.current = { bi, fi, clusterEl, startX: e.clientX, startY: e.clientY, moved: false };
  };

  return (
    <div ref={canvasRef} className="relative w-full rounded-2xl border border-white/8 bg-black/30 overflow-hidden" style={{ height: 360, touchAction: 'none' }}>
      {layout.bouquets.map((b, bi) => {
        const bSelected = selected === `b${bi}`;
        const bConnected = connected && starts[bi] < flowerCount;
        const n = b.flowers.length;
        return (
          <div
            key={bi}
            onPointerDown={(e) => startDrag(e, bi)}
            className="absolute cursor-grab active:cursor-grabbing select-none"
            style={{ left: `${(b.x ?? 0.5) * 100}%`, top: `${(b.y ?? 0.5) * 100}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div data-cluster={bi} className={`relative w-[124px] h-[108px] rounded-xl ${bSelected ? 'ring-1 ring-white/40 bg-white/[0.03]' : ''}`}>
              {/* header */}
              <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 flex items-center gap-1 z-10">
                <span className="text-[10px] font-medium text-white/55 whitespace-nowrap">{b.name}</span>
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full"
                  style={{ background: bConnected ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)', border: `1px solid ${bConnected ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.15)'}` }}>
                  {bConnected ? <Zap className="w-2 h-2 text-emerald-400" fill="currentColor" /> : <ZapOff className="w-2 h-2 text-white/40" />}
                </span>
                {layout.bouquets.length > 1 && (
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => removeBouquet(bi)} className="text-white/25 hover:text-red-400" title="Remove bouquet"><X className="w-3 h-3" /></button>
                )}
              </div>
              {/* flowers in a ring/triangle */}
              {b.flowers.map((f, fi) => {
                const gi = starts[bi] + fi;
                const pf = Array.isArray(live.perFlower) ? live.perFlower[gi] : null;
                const ang = (-90 + (fi * 360) / n) * (Math.PI / 180);
                const fx = f.fx ?? (62 + 30 * Math.cos(ang));
                const fy = f.fy ?? (56 + 28 * Math.sin(ang));
                return (
                  <div key={fi} data-fi={fi} onDoubleClick={(e) => { e.stopPropagation(); openEdit(bi, fi); }}
                    className="absolute cursor-grab active:cursor-grabbing" style={{ left: fx, top: fy, transform: 'translate(-50%, -50%)' }}>
                    <FlowerView flower={f} gi={gi} head={head} isWave={isWave}
                      connected={connected && gi < flowerCount}
                      liveColor={pf?.color ?? live.color} brightness={pf?.brightness ?? live.brightness}
                      selected={selected === `f${gi}`} flashing={flashGi === gi} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Add bouquet */}
      <button onClick={addBouquet} className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white/80 transition">
        <Plus className="w-3.5 h-3.5" /> Bouquet
      </button>
      <span className="absolute top-2 left-3 text-[10px] uppercase tracking-widest text-white/25 pointer-events-none">Drag bouquets to arrange</span>

      {/* Edit popup */}
      {editing != null && draft && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeEdit} onPointerDown={(e) => e.stopPropagation()}>
          <div className="w-full max-w-xs rounded-2xl bg-[#14171c] border border-white/10 p-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Flower settings</span>
              <button onClick={closeEdit} className="p-1 rounded hover:bg-white/10 text-white/50" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-white/40">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">GPIO pin</span>
                <input type="number" inputMode="numeric" value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">LEDs</span>
                <input type="number" inputMode="numeric" value={draft.ledCount} onChange={(e) => setDraft({ ...draft, ledCount: e.target.value })} className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">Layout</span>
                <select value={draft.shape} onChange={(e) => setDraft({ ...draft, shape: e.target.value })} className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30 capitalize">
                  {SHAPES.map((s) => <option key={s} value={s} className="bg-zinc-900 capitalize">{s}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {layout.bouquets[editing.bi].flowers.length > 1 && (
                <button onClick={removeFlower} className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition" title="Remove flower"><Trash2 className="w-4 h-4" /></button>
              )}
              <button onClick={closeEdit} className="flex-1 py-2 rounded-lg bg-white/5 text-white/70 text-sm hover:bg-white/10 transition">Cancel</button>
              <button onClick={saveEdit} className="flex-1 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-white/90 transition flex items-center justify-center gap-1"><Check className="w-4 h-4" /> Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
