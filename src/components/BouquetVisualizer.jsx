import React, { useState, useEffect } from 'react';
import { Zap, ZapOff, Plus, Trash2, X, Check } from 'lucide-react';
import { isConnected, getFlowerCount, onStatus, setTestFlowerCount } from '@/api/flowerBle';
import { loadLayout, saveLayout, newBouquet, totalFlowers, SHAPES } from '@/api/flowerLayout';
import { onFlowerState, getFlowerState } from '@/api/flowerState';

const HUES = [270, 190, 330, 45, 150, 0, 210, 300];
const hueFor = (i) => `hsl(${HUES[i % HUES.length]}, 85%, 62%)`;

// One flower rendered as its LED layout. When connected it shows the REAL live
// output. Clickable to edit.
function FlowerView({ flower, gi, connected, head, liveColor, brightness, isWave, size, onClick }) {
  const n = Math.max(1, flower.ledCount);
  const color = connected ? (liveColor || hueFor(gi)) : hueFor(gi);
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
    if (!connected) { op = 0.1 + 0.1 * comet; r = 3.1 + 1.8 * comet; }
    else if (isWave) { op = Math.max(0.08, (0.12 + 0.88 * comet) * briF); r = 3.1 + 2.3 * comet; }
    else { op = Math.max(0.08, briF); r = 4.2; }
    dots.push(
      <circle key={i} cx={x} cy={y} r={r} fill={color} opacity={op}
        style={(connected && (isWave ? comet > 0.45 : briF > 0.5)) ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined} />,
    );
  }

  const dim = size === 'lg' ? 'w-36 h-36' : 'w-24 h-24';
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 group rounded-2xl p-1 transition hover:bg-white/5" title="Edit this flower">
      <div className="relative">
        <svg viewBox="0 0 140 140" className={`${dim} transition-transform group-hover:scale-[1.03]`}>{dots}</svg>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: connected ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)', border: `1px solid ${connected ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.15)'}` }}>
          {connected ? <Zap className="w-2.5 h-2.5 text-emerald-400" fill="currentColor" /> : <ZapOff className="w-2.5 h-2.5 text-white/40" />}
        </div>
      </div>
      <div className="text-center leading-tight">
        <div className="text-[11px] font-medium text-white/85">{flower.name}</div>
        <div className="text-[10px] text-white/40">GPIO {flower.pin} · {flower.ledCount}</div>
      </div>
    </button>
  );
}

export default function BouquetVisualizer({ size = 'md', editable = true }) {
  const [layout, setLayout] = useState(null);
  const [live, setLive] = useState(getFlowerState());
  const [connected, setConnected] = useState(isConnected());
  const [flowerCount, setFlowerCount] = useState(getFlowerCount());
  const [head, setHead] = useState(0);
  const [editing, setEditing] = useState(null); // { bi, fi }
  const [draft, setDraft] = useState(null);

  useEffect(() => { loadLayout().then((l) => { setLayout(l); setTestFlowerCount(totalFlowers(l)); setFlowerCount(getFlowerCount()); }); }, []);
  useEffect(() => onFlowerState(setLive), []);
  useEffect(() => {
    const sync = () => { setConnected(isConnected()); setFlowerCount(getFlowerCount()); };
    sync();
    return onStatus(sync);
  }, []);
  useEffect(() => { const id = setInterval(() => setHead((h) => h + 1), 90); return () => clearInterval(id); }, []);

  if (!layout) return null;
  const isWave = Array.isArray(live.motion) && live.motion.includes('wave');
  const flowerSize = size === 'lg' && layout.bouquets.length === 1 ? 'lg' : 'md';

  // Global start index per bouquet (matches command/connection channel order).
  const starts = [];
  let acc = 0;
  for (const b of layout.bouquets) { starts.push(acc); acc += b.flowers.length; }

  const persist = (next) => { setLayout(next); saveLayout(next); setTestFlowerCount(totalFlowers(next)); setFlowerCount(getFlowerCount()); };
  const openEdit = (bi, fi) => { setDraft({ ...layout.bouquets[bi].flowers[fi] }); setEditing({ bi, fi }); };
  const closeEdit = () => { setEditing(null); setDraft(null); };
  const saveEdit = () => {
    const { bi, fi } = editing;
    const bouquets = layout.bouquets.map((b, i) => (i !== bi ? b : { ...b, flowers: b.flowers.map((f, j) => (j === fi ? draft : f)) }));
    persist({ ...layout, bouquets });
    closeEdit();
  };
  const removeFlower = () => {
    const { bi, fi } = editing;
    const bouquets = layout.bouquets
      .map((b, i) => (i !== bi ? b : { ...b, flowers: b.flowers.filter((_, j) => j !== fi) }))
      .filter((b) => b.flowers.length);
    persist({ ...layout, bouquets });
    closeEdit();
  };
  const addBouquet = () => persist({ ...layout, bouquets: [...layout.bouquets, newBouquet(layout.bouquets.length)] });
  const removeBouquet = (bi) => persist({ ...layout, bouquets: layout.bouquets.filter((_, i) => i !== bi) });

  return (
    <div className="w-full flex flex-wrap items-stretch justify-center gap-4">
      {layout.bouquets.map((b, bi) => {
        const bConnected = connected && starts[bi] < flowerCount;
        return (
          <div key={bi} className="flex flex-col items-center gap-1.5 rounded-2xl p-2 border border-white/5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white/75">{b.name}</span>
              <span className="flex items-center justify-center w-5 h-5 rounded-full"
                style={{ background: bConnected ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)', border: `1px solid ${bConnected ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.15)'}` }}
                title={bConnected ? 'ESP32 connected' : 'No ESP32'}>
                {bConnected ? <Zap className="w-2.5 h-2.5 text-emerald-400" fill="currentColor" /> : <ZapOff className="w-2.5 h-2.5 text-white/40" />}
              </span>
              {editable && layout.bouquets.length > 1 && (
                <button onClick={() => removeBouquet(bi)} className="p-0.5 rounded text-white/30 hover:text-red-400 transition" title="Remove bouquet"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              {b.flowers.map((f, fi) => {
                const gi = starts[bi] + fi;
                const pf = Array.isArray(live.perFlower) ? live.perFlower[gi] : null;
                return (
                  <FlowerView
                    key={fi}
                    flower={f}
                    gi={gi}
                    head={head}
                    size={flowerSize}
                    connected={connected && gi < flowerCount}
                    liveColor={pf?.color ?? live.color}
                    brightness={pf?.brightness ?? live.brightness}
                    isWave={isWave}
                    onClick={editable ? () => openEdit(bi, fi) : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {editable && (
        <button
          type="button"
          onClick={addBouquet}
          className="self-center rounded-2xl border border-dashed border-white/15 text-white/40 hover:text-white/80 hover:border-white/30 transition flex flex-col items-center justify-center gap-1 px-5 py-8"
          title="Add a bouquet (3 flowers, one ESP32)"
        >
          <Plus className="w-7 h-7" />
          <span className="text-[10px] uppercase tracking-widest">Add bouquet</span>
        </button>
      )}

      {/* Edit popup */}
      {editable && editing && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeEdit}>
          <div className="w-full max-w-xs rounded-2xl bg-[#14171c] border border-white/10 p-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Flower settings</span>
              <button onClick={closeEdit} className="p-1 rounded hover:bg-white/10 text-white/50" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-white/40">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30" />
            </label>

            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">GPIO pin</span>
                <input type="number" inputMode="numeric" value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })}
                  className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">LEDs</span>
                <input type="number" inputMode="numeric" value={draft.ledCount} onChange={(e) => setDraft({ ...draft, ledCount: e.target.value })}
                  className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">Layout</span>
                <select value={draft.shape} onChange={(e) => setDraft({ ...draft, shape: e.target.value })}
                  className="bg-black/40 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30 capitalize">
                  {SHAPES.map((s) => <option key={s} value={s} className="bg-zinc-900 capitalize">{s}</option>)}
                </select>
              </label>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button onClick={removeFlower} className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition" title="Remove flower"><Trash2 className="w-4 h-4" /></button>
              <button onClick={closeEdit} className="flex-1 py-2 rounded-lg bg-white/5 text-white/70 text-sm hover:bg-white/10 transition">Cancel</button>
              <button onClick={saveEdit} className="flex-1 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-white/90 transition flex items-center justify-center gap-1"><Check className="w-4 h-4" /> Save</button>
            </div>
            <p className="text-[10px] text-white/35 leading-relaxed">Changing the pin or LED count updates the app. To rewire the board, the firmware <code>constants.py</code> needs to match.</p>
          </div>
        </div>
      )}
    </div>
  );
}
