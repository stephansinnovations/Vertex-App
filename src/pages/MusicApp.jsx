import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bluetooth, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  isBluetoothSupported,
  connectFlowers,
  disconnect,
  startWave,
  stop as stopFlowers,
} from '@/api/flowerBle';

// A small palette of quick colors plus a full picker. Whatever is chosen is the
// color of the wave sent to the flowers.
const SWATCHES = ['#8b5cf6', '#ff0040', '#ff7a00', '#ffd400', '#00e676', '#00b8ff', '#ff00d4', '#ffffff'];

export default function MusicApp() {
  const navigate = useNavigate();
  const [color, setColor] = useState('#8b5cf6');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [waving, setWaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const supported = isBluetoothSupported();

  const handleConnect = useCallback(async () => {
    setError('');
    setConnecting(true);
    try {
      const count = await connectFlowers();
      setConnected(true);
      // Surface how many flowers answered.
      setError(count ? '' : 'Connected, but no flowers responded.');
    } catch (e) {
      // The user dismissing the chooser shows as "cancelled" — keep that quiet.
      if (!/cancelled|User cancelled/i.test(e?.message || '')) {
        setError(e?.message || 'Could not connect.');
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  // The one button: toggles the colored wave on the bouquet.
  const handleWave = useCallback(async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (!waving) {
        await startWave(color, { speed: 20, brightness: 100 });
        setWaving(true);
      } else {
        await stopFlowers();
        setWaving(false);
      }
    } catch (e) {
      setError(e?.message || 'Command failed.');
      setConnected(false);
      setWaving(false);
    } finally {
      setBusy(false);
    }
  }, [busy, waving, color]);

  // If a wave is running and the color changes, push the new color live.
  useEffect(() => {
    if (!waving) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        await startWave(color, { speed: 20, brightness: 100 });
      } catch {
        if (!cancelled) setWaving(false);
      }
    }, 40);
    return () => { cancelled = true; clearTimeout(t); };
  }, [color, waving]);

  useEffect(() => () => { disconnect(); }, []);

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
        <h1 className="text-lg font-semibold tracking-[0.25em] uppercase text-white/90">Music App</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-10 px-6 pb-16">
        {/* The wave button — a glowing orb that pulses when active */}
        <div className="flex flex-col items-center gap-6">
          <motion.button
            onClick={connected ? handleWave : handleConnect}
            disabled={connecting || busy}
            className="relative w-44 h-44 rounded-full flex items-center justify-center select-none disabled:opacity-70"
            style={{ touchAction: 'manipulation' }}
            whileTap={{ scale: 0.94 }}
          >
            {/* Glow */}
            <motion.div
              className="absolute inset-0 rounded-full"
              animate={waving
                ? { opacity: [0.5, 1, 0.5], scale: [1, 1.25, 1] }
                : { opacity: 0.45, scale: 1 }}
              transition={waving ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : {}}
              style={{ background: `radial-gradient(circle, ${color}cc, transparent 70%)`, margin: -30, filter: 'blur(22px)' }}
            />
            {/* Orb */}
            <div
              className="w-44 h-44 rounded-full flex items-center justify-center relative z-10"
              style={{
                background: `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.22), ${color}55)`,
                boxShadow: `0 10px 50px ${color}77, inset 0 3px 0 rgba(255,255,255,0.55), inset 0 -2px 0 rgba(0,0,0,0.25)`,
                border: '0.5px solid rgba(255,255,255,0.35)',
              }}
            >
              <span className="relative z-10 text-base font-semibold tracking-widest uppercase text-white/95">
                {connecting
                  ? <Loader2 className="w-7 h-7 animate-spin" />
                  : !connected
                    ? 'Connect'
                    : busy
                      ? <Loader2 className="w-7 h-7 animate-spin" />
                      : waving ? 'Stop' : 'Wave'}
              </span>
            </div>
          </motion.button>
          <p className="text-sm text-white/50 h-5">
            {!connected ? 'Tap to connect to your flowers' : waving ? 'Wave running — tap to stop' : 'Tap to send a colored wave'}
          </p>
        </div>

        {/* Color picker */}
        <div className="w-full max-w-sm flex flex-col items-center gap-4">
          <span className="text-xs uppercase tracking-widest text-white/40">Wave color</span>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className="w-9 h-9 rounded-full transition-transform"
                style={{
                  background: c,
                  transform: color.toLowerCase() === c.toLowerCase() ? 'scale(1.18)' : 'scale(1)',
                  boxShadow: color.toLowerCase() === c.toLowerCase()
                    ? `0 0 0 2px #000, 0 0 0 4px ${c}, 0 0 14px ${c}` : 'inset 0 0 0 1px rgba(255,255,255,0.15)',
                }}
              />
            ))}
            {/* Full custom picker */}
            <label
              className="w-9 h-9 rounded-full cursor-pointer relative overflow-hidden"
              style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)' }}
              title="Custom color"
            >
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Status / connection control */}
        <div className="flex flex-col items-center gap-2 min-h-[44px]">
          {connected && (
            <button
              onClick={async () => { await disconnect(); setConnected(false); setWaving(false); }}
              className="flex items-center gap-2 text-xs text-white/45 hover:text-white/70 transition"
            >
              <Bluetooth className="w-3.5 h-3.5" /> Disconnect
            </button>
          )}
          {!supported && (
            <p className="text-xs text-amber-400/80 text-center max-w-xs">
              This browser doesn't support Web Bluetooth. Open the Music App in Chrome on desktop or Android.
            </p>
          )}
          {error && <p className="text-xs text-red-400/80 text-center max-w-xs">{error}</p>}
        </div>
      </div>
    </div>
  );
}
