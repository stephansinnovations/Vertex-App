import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Bluetooth, Zap, ZapOff, Check, Loader2 } from 'lucide-react';
import {
  isBluetoothSupported,
  connectFlowers,
  disconnect,
  isConnected,
  getFlowerCount,
  onStatus,
} from '@/api/flowerBle';
import { loadLayout, saveLayout, newFlower, SHAPES } from '@/api/flowerLayout';

// Distinct hue per flower so each ring is easy to tell apart in the visualization.
const HUES = [270, 190, 330, 45, 150, 0, 210, 300];
const hueFor = (i) => `hsl(${HUES[i % HUES.length]}, 85%, 62%)`;

// One flower rendered as its LED layout (a ring of dots for 'circle', a row for
// 'line'). A travelling "comet" head animates the wave; a badge shows whether the
// flower is currently connected over Bluetooth.
function FlowerView({ flower, index, connected, head }) {
  const n = Math.max(1, flower.ledCount);
  const color = hueFor(index);
  const cx = 70;
  const cy = 70;
  const R = 52;
  const tail = Math.max(3, Math.round(n / 3));
  const headIdx = head % n;

  const dots = [];
  for (let i = 0; i < n; i++) {
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
    const f = d < tail ? 1 - d / tail : 0;
    const op = connected ? 0.18 + 0.82 * f : 0.1 + 0.12 * f;
    const r = 3.1 + 2.3 * f;
    dots.push(
      <circle
        key={i}
        cx={x}
        cy={y}
        r={r}
        fill={color}
        opacity={op}
        style={f > 0.45 ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}
      />,
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg viewBox="0 0 140 140" className="w-32 h-32">
          {dots}
        </svg>
        {/* Connection badge */}
        <div
          className="absolute -top-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
          style={{
            background: connected ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${connected ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.15)'}`,
          }}
          title={connected ? 'Connected' : 'Not connected'}
        >
          {connected
            ? <Zap className="w-3.5 h-3.5 text-emerald-400" fill="currentColor" />
            : <ZapOff className="w-3.5 h-3.5 text-white/40" />}
        </div>
      </div>
      <div className="text-center leading-tight">
        <div className="text-xs font-medium text-white/85">{flower.name}</div>
        <div className="text-[10px] text-white/40">GPIO {flower.pin} · {flower.ledCount} LEDs</div>
      </div>
    </div>
  );
}

export default function FlowerSetup() {
  const navigate = useNavigate();
  const [layout, setLayout] = useState(null);
  const [connected, setConnected] = useState(isConnected());
  const [flowerCount, setFlowerCount] = useState(getFlowerCount());
  const [connecting, setConnecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [head, setHead] = useState(0);
  const [error, setError] = useState('');

  const supported = isBluetoothSupported();

  useEffect(() => { loadLayout().then(setLayout); }, []);

  // Reflect live BLE connection / flower count.
  useEffect(() => {
    const sync = () => { setConnected(isConnected()); setFlowerCount(getFlowerCount()); };
    sync();
    return onStatus(sync);
  }, []);

  // Drive the wave animation in the visualization.
  useEffect(() => {
    const id = setInterval(() => setHead((h) => h + 1), 90);
    return () => clearInterval(id);
  }, []);

  const handleConnect = useCallback(async () => {
    setError('');
    setConnecting(true);
    try {
      await connectFlowers();
      setConnected(true);
      setFlowerCount(getFlowerCount());
    } catch (e) {
      if (!/cancelled|User cancelled/i.test(e?.message || '')) setError(e?.message || 'Could not connect.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const update = (i, patch) => setLayout((l) => ({ ...l, flowers: l.flowers.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) }));
  const addFlower = () => setLayout((l) => ({ ...l, flowers: [...l.flowers, newFlower(l.flowers.length)] }));
  const removeFlower = (i) => setLayout((l) => ({ ...l, flowers: l.flowers.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    const clean = await saveLayout(layout);
    setLayout(clean);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  if (!layout) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-white/50 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#0a0a12] via-[#0d0a1a] to-black text-white flex flex-col">
      {/* Header */}
      <div className="relative flex items-center justify-center px-4 py-5">
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition"
          aria-label="Back"
        >
          <ArrowLeft className="w-6 h-6 text-white/80" />
        </button>
        <h1 className="text-lg font-semibold tracking-[0.25em] uppercase text-white/90">Flower Setup</h1>
      </div>

      <div className="flex-1 flex flex-col items-center gap-8 px-5 pb-20 max-w-lg w-full mx-auto">
        {/* Visualization room */}
        <div className="w-full rounded-3xl bg-black/40 border border-white/8 p-5 flex flex-col items-center gap-4"
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between w-full">
            <span className="text-xs uppercase tracking-widest text-white/40">Your bouquet</span>
            <span className="text-xs text-white/45">
              {connected ? `${flowerCount} connected` : 'offline'}
            </span>
          </div>
          <div className="flex flex-wrap items-start justify-center gap-5 py-2">
            {layout.flowers.map((f, i) => (
              <FlowerView key={i} flower={f} index={i} head={head} connected={connected && i < flowerCount} />
            ))}
          </div>
          {!connected && (
            <button
              onClick={handleConnect}
              disabled={connecting || !supported}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm transition disabled:opacity-50"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />}
              {connecting ? 'Connecting…' : 'Connect to see live status'}
            </button>
          )}
          {connected && (
            <button onClick={async () => { await disconnect(); setConnected(false); setFlowerCount(0); }}
              className="flex items-center gap-2 text-xs text-white/45 hover:text-white/70 transition">
              <Bluetooth className="w-3.5 h-3.5" /> Disconnect
            </button>
          )}
        </div>

        {/* Editor */}
        <div className="w-full flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-white/40">Flowers &amp; wiring</span>
            <span className="text-[11px] text-white/35">{layout.flowers.length} flower{layout.flowers.length === 1 ? '' : 's'}</span>
          </div>

          {layout.flowers.map((f, i) => {
            const isOn = connected && i < flowerCount;
            return (
              <div key={i} className="rounded-2xl bg-white/[0.04] border border-white/8 p-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: hueFor(i) }} />
                  <input
                    value={f.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    className="flex-1 bg-transparent text-sm font-medium text-white outline-none border-b border-transparent focus:border-white/20 py-1"
                    placeholder="Flower name"
                  />
                  <span
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
                    style={{
                      background: isOn ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                      color: isOn ? '#34d399' : 'rgba(255,255,255,0.4)',
                    }}
                  >
                    {isOn ? <><Check className="w-3 h-3" /> Connected</> : <><ZapOff className="w-3 h-3" /> Offline</>}
                  </span>
                  {layout.flowers.length > 1 && (
                    <button onClick={() => removeFlower(i)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition" aria-label="Remove flower">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-white/35">GPIO pin</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={f.pin}
                      onChange={(e) => update(i, { pin: e.target.value })}
                      className="bg-black/30 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-white/35">LEDs / strip</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={f.ledCount}
                      onChange={(e) => update(i, { ledCount: e.target.value })}
                      className="bg-black/30 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-white/35">Layout</span>
                    <select
                      value={f.shape}
                      onChange={(e) => update(i, { shape: e.target.value })}
                      className="bg-black/30 rounded-lg px-2 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30 capitalize"
                    >
                      {SHAPES.map((s) => <option key={s} value={s} className="bg-zinc-900 capitalize">{s}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}

          <button onClick={addFlower} className="flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-dashed border-white/15 text-white/50 hover:text-white/80 hover:border-white/30 transition text-sm">
            <Plus className="w-4 h-4" /> Add flower
          </button>

          {error && <p className="text-xs text-red-400/80 text-center">{error}</p>}

          <button onClick={handleSave} className="mt-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition">
            {saved ? <><Check className="w-4 h-4" /> Saved</> : 'Save layout'}
          </button>
          <p className="text-[11px] text-white/35 text-center leading-relaxed px-2">
            This is the app&apos;s model of your hardware (used for the visualization, connection
            status, and patterns). Changing the physical pins or LED counts also needs a firmware
            reflash to match the board.
          </p>
        </div>
      </div>
    </div>
  );
}
