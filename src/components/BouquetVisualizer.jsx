import React, { useState, useEffect } from 'react';
import { Zap, ZapOff } from 'lucide-react';
import { isConnected, getFlowerCount, onStatus } from '@/api/flowerBle';
import { loadLayout } from '@/api/flowerLayout';
import { onFlowerState, getFlowerState } from '@/api/flowerState';

// Distinct hue per flower, used only for identification when idle/offline.
const HUES = [270, 190, 330, 45, 150, 0, 210, 300];
const hueFor = (i) => `hsl(${HUES[i % HUES.length]}, 85%, 62%)`;

// One flower rendered as its LED layout (a ring of dots for 'circle', a row for
// 'line'). When connected it shows the REAL live output: the current color at the
// current brightness, animating the wave if one is running.
function FlowerView({ flower, index, connected, head, liveColor, brightness, isWave, size }) {
  const n = Math.max(1, flower.ledCount);
  const color = connected ? (liveColor || hueFor(index)) : hueFor(index);
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
    if (!connected) {
      op = 0.1 + 0.1 * comet;
      r = 3.1 + 1.8 * comet;
    } else if (isWave) {
      op = Math.max(0.08, (0.12 + 0.88 * comet) * briF);
      r = 3.1 + 2.3 * comet;
    } else {
      op = Math.max(0.08, briF);
      r = 4.2;
    }
    dots.push(
      <circle
        key={i}
        cx={x}
        cy={y}
        r={r}
        fill={color}
        opacity={op}
        style={(connected && (isWave ? comet > 0.45 : briF > 0.5)) ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}
      />,
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg viewBox="0 0 140 140" className={size === 'lg' ? 'w-40 h-40' : 'w-28 h-28'}>{dots}</svg>
        <div
          className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
          style={{
            background: connected ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${connected ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.15)'}`,
          }}
          title={connected ? 'Connected' : 'Not connected'}
        >
          {connected ? <Zap className="w-3 h-3 text-emerald-400" fill="currentColor" /> : <ZapOff className="w-3 h-3 text-white/40" />}
        </div>
      </div>
      <div className="text-center leading-tight">
        <div className="text-xs font-medium text-white/85">{flower.name}</div>
        <div className="text-[10px] text-white/40">GPIO {flower.pin} · {flower.ledCount} LEDs</div>
      </div>
    </div>
  );
}

// Live visualization of the bouquet — reads the saved layout + live flower state +
// BLE connection and renders each flower showing what it's actually playing.
export default function BouquetVisualizer({ size = 'md' }) {
  const [layout, setLayout] = useState(null);
  const [live, setLive] = useState(getFlowerState());
  const [connected, setConnected] = useState(isConnected());
  const [flowerCount, setFlowerCount] = useState(getFlowerCount());
  const [head, setHead] = useState(0);

  useEffect(() => { loadLayout().then(setLayout); }, []);
  useEffect(() => onFlowerState(setLive), []);
  useEffect(() => {
    const sync = () => { setConnected(isConnected()); setFlowerCount(getFlowerCount()); };
    sync();
    return onStatus(sync);
  }, []);
  useEffect(() => { const id = setInterval(() => setHead((h) => h + 1), 90); return () => clearInterval(id); }, []);

  if (!layout) return null;
  const isWave = Array.isArray(live.motion) && live.motion.includes('wave');

  return (
    <div className="flex flex-wrap items-start justify-center gap-4">
      {layout.flowers.map((f, i) => {
        const pf = Array.isArray(live.perFlower) ? live.perFlower[i] : null;
        return (
          <FlowerView
            key={i}
            flower={f}
            index={i}
            head={head}
            size={size === 'lg' ? 'lg' : 'md'}
            connected={connected && i < flowerCount}
            liveColor={pf?.color ?? live.color}
            brightness={pf?.brightness ?? live.brightness}
            isWave={isWave}
          />
        );
      })}
    </div>
  );
}
