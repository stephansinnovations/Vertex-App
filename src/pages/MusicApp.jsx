import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bluetooth, Loader2, Mic, MonitorSpeaker, Music, Settings2 } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  isBluetoothSupported,
  connectFlowers,
  disconnect,
  startWave,
  stop as stopFlowers,
  setSolid,
  setBrightness as setFlowerBrightness,
  sendCommand,
  sendReactive,
  onStatus,
} from '@/api/flowerBle';
import { AudioReactor, hsvToHex } from '@/api/audioReactive';

// A small palette of quick colors plus a full picker. Whatever is chosen is the
// color of the wave sent to the flowers.
const SWATCHES = ['#8b5cf6', '#ff0040', '#ff7a00', '#ffd400', '#00e676', '#00b8ff', '#ff00d4', '#ffffff'];

export default function MusicApp() {
  const navigate = useNavigate();
  const [color, setColor] = useState('#8b5cf6');
  const [brightness, setBrightness] = useState(100);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [waving, setWaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // --- Music-sync state ---
  const [syncing, setSyncing] = useState(false);
  const [audioSource, setAudioSource] = useState('mic'); // 'mic' | 'tab'
  const [autoColor, setAutoColor] = useState(true);
  const [level, setLevel] = useState(0); // smoothed meter value 0..1
  const reactorRef = useRef(null);
  const peakRef = useRef(0);
  const hueRef = useRef(270);
  const lastMeterRef = useRef(0);
  const wakeLockRef = useRef(null);
  // Keep the latest color/autoColor in refs so the audio callback isn't stale.
  const colorRef = useRef(color);
  const autoColorRef = useRef(autoColor);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { autoColorRef.current = autoColor; }, [autoColor]);

  const supported = isBluetoothSupported();

  const handleConnect = useCallback(async () => {
    setError('');
    setConnecting(true);
    try {
      const count = await connectFlowers();
      setConnected(true);
      // Instant feedback: light the flowers solid in the chosen color so it's
      // obvious the connection works (and confirms commands are landing).
      try { await setSolid(color, brightness); } catch { /* surfaced on Wave */ }
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
        await startWave(color, { speed: 20, brightness });
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
        await startWave(color, { speed: 20, brightness });
      } catch {
        if (!cancelled) setWaving(false);
      }
    }, 40);
    return () => { cancelled = true; clearTimeout(t); };
  }, [color, waving, brightness]);

  // Push brightness live whenever it changes while connected (debounced). When a
  // wave is running the color effect above already includes brightness, so only
  // send the standalone brightness command when steady.
  useEffect(() => {
    if (!connected || waving) return;
    const t = setTimeout(() => { setFlowerBrightness(brightness).catch(() => {}); }, 60);
    return () => clearTimeout(t);
  }, [brightness, connected, waving]);

  // Map each audio frame onto a flower command. Brightness follows an envelope of
  // the music's energy (fast attack, slow release) and snaps to 100 on beats; the
  // colour either stays the chosen swatch or drifts through the spectrum.
  const handleAudioFrame = useCallback(({ level: lvl, beat }) => {
    const peak = Math.max(lvl, peakRef.current * 0.9);
    peakRef.current = peak;
    let bri = Math.round(Math.min(1, 0.18 + peak * 2.4) * 100);
    if (beat) bri = 100;
    bri = Math.max(6, Math.min(100, bri));

    const cmd = { br: String(bri) };
    if (autoColorRef.current) {
      hueRef.current = (hueRef.current + 0.6 + peak * 6 + (beat ? 35 : 0)) % 360;
      cmd.co = hsvToHex(hueRef.current, 1, 1);
    } else {
      cmd.co = colorRef.current;
    }
    sendReactive(cmd);

    // Update the on-screen meter at ~15fps so we don't re-render every frame.
    const now = performance.now();
    if (now - lastMeterRef.current > 66) {
      lastMeterRef.current = now;
      setLevel(peak);
    }
  }, []);

  const handleSyncToggle = useCallback(async () => {
    setError('');
    if (syncing) {
      reactorRef.current?.stop();
      reactorRef.current = null;
      setSyncing(false);
      setLevel(0);
      try { await stopFlowers(); } catch { /* ignore */ }
      return;
    }
    if (!connected) { setError('Connect to your flowers first.'); return; }
    try {
      const reactor = new AudioReactor();
      reactor.onFrame = handleAudioFrame;
      reactor.onEnded = () => { setSyncing(false); setLevel(0); reactorRef.current = null; };
      await reactor.start(audioSource);
      reactorRef.current = reactor;
      setSyncing(true);
      setWaving(false);
      peakRef.current = 0;
      // Base look: a continuous wave that the live brightness/colour ride on.
      try {
        await sendCommand({ mo: ['wave'] });
        await sendCommand({ sp: '30' });
      } catch { /* surfaced via reactive sends */ }
    } catch (e) {
      reactorRef.current?.stop();
      reactorRef.current = null;
      setError(/denied|NotAllowed/i.test(e?.message || '')
        ? 'Audio permission denied — allow microphone/tab audio and try again.'
        : (e?.message || 'Could not start audio.'));
      setSyncing(false);
    }
  }, [syncing, connected, audioSource, handleAudioFrame]);

  // Reflect BLE status (including auto-reconnect after Chrome drops the link when
  // the tab is backgrounded).
  useEffect(() => {
    const off = onStatus((s) => {
      if (s === 'connected') { setConnected(true); setReconnecting(false); }
      else if (s === 'reconnecting') { setReconnecting(true); }
      else if (s === 'disconnected' || s === 'failed') {
        setConnected(false);
        setReconnecting(false);
        if (s === 'failed') {
          setError('Lost the flowers and couldn’t reconnect. Tap Connect again.');
          reactorRef.current?.stop();
          reactorRef.current = null;
          setSyncing(false);
          setLevel(0);
        }
      }
    });
    return off;
  }, []);

  // Hold a screen wake lock while syncing so the OS/browser is less likely to
  // throttle or freeze us mid-show. (Auto-releases when the tab is hidden, so we
  // re-acquire on visibility change.)
  useEffect(() => {
    if (!syncing) return undefined;
    let released = false;
    const acquire = async () => {
      try {
        if (navigator.wakeLock && document.visibilityState === 'visible') {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch { /* not critical */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible' && !released) acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVis);
      try { wakeLockRef.current?.release(); } catch { /* ignore */ }
      wakeLockRef.current = null;
    };
  }, [syncing]);

  useEffect(() => () => { reactorRef.current?.stop(); disconnect(); }, []);

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
        <button
          onClick={() => navigate('/FlowerSetup')}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition"
          aria-label="Flower setup"
        >
          <Settings2 className="w-5 h-5 text-white/70" />
        </button>
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

        {/* Brightness dial */}
        <div className="w-full max-w-sm flex flex-col items-center gap-3">
          <div className="flex items-center justify-between w-full px-1">
            <span className="text-xs uppercase tracking-widest text-white/40">Brightness</span>
            <span className="text-xs tabular-nums text-white/60">{brightness}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            aria-label="Brightness"
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{
              accentColor: color,
              background: `linear-gradient(to right, ${color} ${brightness}%, rgba(255,255,255,0.12) ${brightness}%)`,
            }}
          />
        </div>

        {/* Music sync */}
        <div className="w-full max-w-sm flex flex-col items-center gap-4 pt-2 border-t border-white/5">
          <span className="text-xs uppercase tracking-widest text-white/40">Sync to music</span>

          {/* Audio source selector */}
          <div className="flex items-center gap-2 p-1 rounded-full bg-white/5">
            {[
              { id: 'mic', label: 'Microphone', Icon: Mic },
              { id: 'tab', label: 'Browser tab', Icon: MonitorSpeaker },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => !syncing && setAudioSource(id)}
                disabled={syncing}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition disabled:opacity-50 ${
                  audioSource === id ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Sync button */}
          <button
            onClick={handleSyncToggle}
            disabled={!connected}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold transition disabled:opacity-40 ${
              syncing ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <Music className="w-4 h-4" /> {syncing ? 'Stop sync' : 'Sync to music'}
          </button>

          {/* Live level meter */}
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${Math.min(100, Math.round(level * 140))}%`,
                background: autoColor ? `hsl(${hueRef.current}, 90%, 60%)` : color,
              }}
            />
          </div>

          {/* Auto-color toggle */}
          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoColor}
              onChange={(e) => setAutoColor(e.target.checked)}
              className="accent-current"
              style={{ accentColor: color }}
            />
            Auto-cycle color with the music
          </label>
          {syncing && audioSource === 'mic' && (
            <p className="text-[11px] text-white/35 text-center max-w-xs">Turn your music up so the mic can hear it.</p>
          )}
          {audioSource === 'tab' && (
            <p className="text-[11px] text-amber-300/60 text-center max-w-xs leading-relaxed">
              Tab mode: Chrome may pause Bluetooth when this tab is hidden. Keep the Music App
              <b className="text-amber-200/80"> visible in its own window</b> (drag this tab out, side-by-side with your music), or just use
              <b className="text-amber-200/80"> Microphone</b> — it needs no tab switching.
            </p>
          )}
        </div>

        {/* Status / connection control */}
        <div className="flex flex-col items-center gap-2 min-h-[44px]">
          {reconnecting && (
            <span className="flex items-center gap-2 text-xs text-amber-300/70">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reconnecting to flowers…
            </span>
          )}
          {connected && (
            <button
              onClick={async () => { reactorRef.current?.stop(); reactorRef.current = null; setSyncing(false); setLevel(0); await disconnect(); setConnected(false); setWaving(false); }}
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
