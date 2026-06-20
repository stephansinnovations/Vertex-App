import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bluetooth, Loader2, Mic, MonitorSpeaker, Music, Play, Square, RefreshCw, Sparkles, Check, Settings } from 'lucide-react';
import {
  isBluetoothSupported,
  connectFlowers,
  disconnect,
  startWave,
  stop as stopFlowers,
  setSolid,
  setBrightness as setFlowerBrightness,
  sendCommand,
  refreshFlowers,
  onStatus,
  setTestMode,
  isTestMode,
  setTestFlowerCount,
} from '@/api/flowerBle';
import { AudioReactor, BpmTracker } from '@/api/audioReactive';
import { phaseLearner, kickModel, phaseColor, resetMusicModel } from '@/api/musicML';
import { modEngine } from '@/api/modEngine';
import BouquetVisualizer from '@/components/BouquetVisualizer';
import PatternScreen from '@/components/PatternScreen';
import LfoModule from '@/components/LfoModule';
import Knob from '@/components/Knob';

const SWATCHES = ['#8b5cf6', '#ff0040', '#ff7a00', '#ffd400', '#00e676', '#00b8ff', '#ff00d4', '#ffffff'];

// A pair of vertical bars: kick-drum envelope (left) + beat/BPM metronome (right).
// Reads the live values straight off modEngine; the parent re-renders on engine emits.
function SyncMeters({ kick, beatFill, bpm, compact = false }) {
  const h = compact ? 88 : 120;
  const Bar = ({ value, color, glow }) => (
    <div className="relative w-3.5 rounded-full bg-white/8 overflow-hidden" style={{ height: h }}>
      <div className="absolute bottom-0 left-0 right-0 rounded-full"
        style={{ height: `${Math.round(Math.min(1, value) * 100)}%`, background: color, boxShadow: value > 0.25 ? `0 0 10px ${glow}` : 'none', transition: 'height 70ms linear' }} />
    </div>
  );
  return (
    <div className="flex items-end gap-3">
      <div className="flex flex-col items-center gap-1.5">
        <Bar value={kick} color="#ff6a00" glow="rgba(255,106,0,0.6)" />
        <span className="text-[9px] uppercase tracking-widest text-white/45">Kick</span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <Bar value={beatFill} color="#36d6c3" glow="rgba(54,214,195,0.6)" />
        <span className="text-[9px] uppercase tracking-widest text-white/45">{bpm} <span className="text-white/30">BPM</span></span>
      </div>
    </div>
  );
}
const LFO_OPTS = modEngine.lfos.map((l, i) => ({ value: `lfo:${i}`, label: l.name }));
const MACRO_OPTS = modEngine.macros.map((m, i) => ({ value: `macro:${i}`, label: m.name }));

// Dropdown to route a parameter (of the selected target) to a Macro or LFO.
function SourceSelect({ sel, name, bump }) {
  const t = modEngine.getTarget(sel);
  return (
    <select
      value={t[name].source}
      onChange={(e) => { modEngine.getTarget(sel)[name].source = e.target.value; modEngine.applyOnce(); bump(); }}
      className="w-full bg-black/40 rounded-lg px-2 py-1.5 text-xs text-white/85 outline-none border border-white/10 focus:border-white/30"
    >
      <option value="" className="bg-zinc-900">No modulation</option>
      {MACRO_OPTS.map((o) => <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>)}
      {LFO_OPTS.map((o) => <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>)}
    </select>
  );
}

function ParamCard({ title, children }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/8 p-3 flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-widest text-white/40">{title}</span>
      {children}
    </div>
  );
}

// Human label for a selection target id.
function targetName(sel, layout) {
  if (sel === 'all' || !layout) return 'All flowers';
  if (sel[0] === 'b') { const bi = Number(sel.slice(1)); return layout.bouquets[bi]?.name || `Bouquet ${bi + 1}`; }
  if (sel[0] === 'f') {
    const gi = Number(sel.slice(1));
    let acc = 0;
    for (const b of layout.bouquets) { for (const f of b.flowers) { if (acc === gi) return f.name; acc += 1; } }
  }
  return 'Flower';
}

export default function MusicApp() {
  const navigate = useNavigate();
  const [, bump] = useReducer((x) => x + 1, 0);
  const [color, setColor] = useState('#8b5cf6');
  const [brightness, setBrightness] = useState(100);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [waving, setWaving] = useState(false);
  const [running, setRunning] = useState(modEngine.running);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testMode, setTestModeState] = useState(isTestMode());
  const [selected, setSelected] = useState('all'); // 'all' | b<bi> | f<gi>
  const [layout, setLayout] = useState(null);
  const [syncOpen, setSyncOpen] = useState(false);

  // When the layout loads/changes, tell the engine each flower's bouquet (for
  // per-bouquet/per-flower params) and its canvas position (for the spatial pattern).
  const handleLayout = useCallback((l, positions) => {
    setLayout(l);
    const map = [];
    l.bouquets.forEach((b, bi) => b.flowers.forEach(() => map.push(bi)));
    modEngine.setFlowerMap(map);
    // BouquetVisualizer reports accurate canvas positions; fall back to the bouquet
    // centers if it didn't (e.g. before the canvas is measured).
    modEngine.setFlowerPositions(positions || l.bouquets.flatMap((b) => b.flowers.map(() => ({ x: b.x ?? 0.5, y: b.y ?? 0.5 }))));
    setTestFlowerCount(map.length); // so test mode lights every flower
    modEngine.applyOnce();
  }, []);

  // Read/write a manual value or source on the currently-selected target.
  const setParam = (name, field, val) => {
    modEngine.getTarget(selected)[name][field] = val;
    modEngine.applyOnce();
    bump();
  };

  const toggleTest = (on) => {
    if (on === testMode) return;
    setTestMode(on); // emits status → connected reflects it
    setTestModeState(on);
    setError('');
  };

  // --- Tempo-detection (Sync to music) state ---
  const [syncing, setSyncing] = useState(false);
  const [audioSource, setAudioSource] = useState('mic'); // 'mic' | 'tab'
  const [level, setLevel] = useState(0);
  const reactorRef = useRef(null);
  const trackerRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Re-render on engine ticks so macro meters / playhead stay live.
  useEffect(() => modEngine.subscribe(bump), []);

  const supported = isBluetoothSupported();

  const handleConnect = useCallback(async () => {
    setError('');
    setConnecting(true);
    try {
      const count = await connectFlowers();
      setConnected(true);
      try { await setSolid(color, brightness); } catch { /* surfaced on Wave */ }
      setError(count ? '' : 'Connected, but no flowers responded.');
    } catch (e) {
      if (!/cancelled|User cancelled/i.test(e?.message || '')) setError(e?.message || 'Could not connect.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const toggleRun = () => {
    if (modEngine.running) { modEngine.stop(); setRunning(false); }
    else { modEngine.start(); setRunning(true); }
  };

  // Re-initialize all strips to recover a stuck/dark flower without USB.
  const handleRefresh = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      await refreshFlowers();
      // Re-poke the current color/brightness so a recovered strip shows it again.
      try { await sendCommand({ co: color, br: String(brightness) }); } catch { /* ignore */ }
    } catch (e) {
      setError(e?.message || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }, [color, brightness]);

  const handleWave = useCallback(async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (!waving) { await startWave(color, { speed: 20, brightness }); setWaving(true); }
      else { await stopFlowers(); setWaving(false); }
    } catch (e) {
      setError(e?.message || 'Command failed.');
      setWaving(false);
    } finally {
      setBusy(false);
    }
  }, [busy, waving, color, brightness]);

  // Manual color → push live when not modulated and not running a wave/engine.
  useEffect(() => {
    if (!connected || waving || running) return;
    const t = setTimeout(() => { setSolid(color, brightness).catch(() => {}); }, 40);
    return () => clearTimeout(t);
  }, [color, connected, waving, running]);

  // Manual brightness → push live (debounced) when steady.
  useEffect(() => {
    if (!connected || waving || running) return;
    const t = setTimeout(() => { setFlowerBrightness(brightness).catch(() => {}); }, 60);
    return () => clearTimeout(t);
  }, [brightness, connected, waving, running]);

  // Clear all live audio-detection readouts on the engine (kick/level/bands/phase).
  const resetSyncMeters = useCallback(() => {
    modEngine.detecting = false;
    modEngine.audioLevel = 0;
    modEngine.kick = 0;
    modEngine.bands = { bass: 0, drums: 0, melody: 0 };
    modEngine.phase = 'Chorus';
    modEngine.lastBeatMs = 0;
    // Stop scene-driven lights when detection ends (keep the autoScene preference).
    if (modEngine.autoScene && !modEngine.running) modEngine.setPatternDrive(false);
    modEngine._sceneBase = null;
  }, []);

  // Sync to music = detect the music's BPM and feed it to the LFOs (tempo-synced
  // LFOs follow it; Trigger-mode LFOs retrigger on the beat). Nothing else.
  const handleSyncToggle = useCallback(async () => {
    setError('');
    if (syncing) {
      reactorRef.current?.stop();
      reactorRef.current = null;
      setSyncing(false);
      setLevel(0);
      resetSyncMeters();
      modEngine.emit();
      return;
    }
    try {
      trackerRef.current = new BpmTracker();
      phaseLearner.beginSession();
      const reactor = new AudioReactor();
      let lastEmit = 0;
      reactor.onFrame = ({ level: lvl, beat, bands, kick }) => {
        modEngine.audioLevel = lvl;
        if (bands) modEngine.bands = bands;
        modEngine.kick = kick ?? 0;
        if (beat) { modEngine.bpm = trackerRef.current.push(performance.now()); modEngine.onBeat(); modEngine.lastBeatMs = performance.now(); }
        const now = performance.now();
        if (now - lastEmit > 60) {
          lastEmit = now;
          modEngine.onSection(phaseLearner.push({ level: lvl, bass: bands?.bass, perc: bands?.drums, mel: bands?.melody, kick: modEngine.kick }));
          setLevel(lvl);
          modEngine.emit();
        }
      };
      reactor.onEnded = () => { setSyncing(false); setLevel(0); reactorRef.current = null; resetSyncMeters(); modEngine.emit(); };
      await reactor.start(audioSource);
      reactorRef.current = reactor;
      modEngine.detecting = true;
      setSyncing(true);
    } catch (e) {
      reactorRef.current?.stop();
      reactorRef.current = null;
      setError(/denied|NotAllowed/i.test(e?.message || '')
        ? 'Audio permission denied — allow microphone/tab audio and try again.'
        : (e?.message || 'Could not listen.'));
      setSyncing(false);
    }
  }, [syncing, audioSource]);

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
          modEngine.detecting = false;
          modEngine.audioLevel = 0;
          modEngine.kick = 0;
          modEngine.bands = { bass: 0, drums: 0, melody: 0 };
          modEngine.phase = 'Chorus';
          modEngine.lastBeatMs = 0;
        }
      }
    });
    return off;
  }, []);

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

  useEffect(() => () => { reactorRef.current?.stop(); }, []);

  // Live readouts for the sync meters / phase tag (recomputed each engine emit).
  const bpm = modEngine.bpm || 120;
  const beatFill = (syncing && modEngine.lastBeatMs)
    ? Math.max(0, 1 - (performance.now() - modEngine.lastBeatMs) / (60000 / bpm))
    : 0;
  const phaseLabel = modEngine.phase || 'Chorus';
  const phaseCol = phaseColor(phaseLabel);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#0a0a12] via-[#0d0a1a] to-black text-white flex flex-col">
      {/* Header */}
      <div className="relative flex items-center justify-center px-4 py-4">
        <button onClick={() => navigate(-1)} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition" aria-label="Back">
          <ArrowLeft className="w-6 h-6 text-white/80" />
        </button>
        <h1 className="text-lg font-semibold tracking-[0.25em] uppercase text-white/90">Music App</h1>
      </div>

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 pb-24 flex flex-col gap-5">
        {/* Top bar: Live / Test mode / Sync to music */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 rounded-full bg-white/5">
            {[{ id: false, label: 'Live' }, { id: true, label: 'Test mode' }].map(({ id, label }) => (
              <button key={label} onClick={() => toggleTest(id)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${testMode === id ? (id ? 'bg-[#36d6c3] text-black' : 'bg-white text-black') : 'text-white/50 hover:text-white/80'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Sync to music — one press enables it; gear opens source/scene/learning settings */}
          <div className="flex items-center gap-1.5">
            <button onClick={handleSyncToggle}
              className={`relative overflow-hidden flex flex-col items-center justify-center px-5 py-1.5 rounded-full text-xs font-medium transition ${syncing ? 'bg-[#36d6c3] text-black' : 'bg-white/5 text-white/70 hover:text-white'}`}>
              <span className="flex items-center gap-1.5">
                {syncing ? <Check className="w-3.5 h-3.5" /> : <Music className="w-3.5 h-3.5" />}
                {syncing ? 'Synced' : 'Sync to music'}
              </span>
              <span className="mt-1 w-24 h-1 rounded-full bg-black/20 overflow-hidden">
                <span className="block h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.min(100, Math.round(level * 140))}%`, background: syncing ? '#0b0d11' : '#36d6c3' }} />
              </span>
            </button>
            <button onClick={() => setSyncOpen(true)} title="Sync settings — source, auto scenes, learning" aria-label="Sync settings"
              className="p-2 rounded-full bg-white/5 text-white/50 hover:text-white transition">
              <Settings className="w-4 h-4" />
            </button>
          </div>
          {/* Learned song-section tag — grows new categories the more it listens */}
          <span
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition border"
            style={syncing
              ? { color: phaseCol, borderColor: phaseCol, background: 'rgba(255,255,255,0.04)', boxShadow: `0 0 12px ${phaseCol}` }
              : { color: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.1)', background: 'transparent' }}
            title="Learned song section">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: syncing ? phaseCol : 'rgba(255,255,255,0.3)' }} />
            {syncing ? phaseLabel : 'Section'}
          </span>
          {syncing && <span className="text-[11px] text-[#36d6c3] w-full text-center">Alright, it&apos;s synced ✓ — reading the beat from {audioSource === 'tab' ? 'this browser tab' : 'the microphone'}. Anything set to “Sync to BPM” now follows the music.</span>}
          {testMode && <span className="text-[11px] text-[#36d6c3]/80 w-full text-center">Pretending an ESP32 is connected — no hardware needed.</span>}
        </div>

        {/* Visualization + transport */}
        <div className="flex flex-col items-center gap-4">
          <BouquetVisualizer selected={selected} onSelect={setSelected} onLayout={handleLayout} />
          <div className="flex items-center gap-3 flex-wrap justify-center">
            {!connected ? (
              <button onClick={handleConnect} disabled={connecting || !supported} className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium transition disabled:opacity-50">
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />}
                {connecting ? 'Connecting…' : 'Connect'}
              </button>
            ) : (
              <button onClick={toggleRun} className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition ${running ? 'bg-white text-black' : 'bg-[#36d6c3]/90 text-black hover:bg-[#36d6c3]'}`}>
                {running ? <><Square className="w-4 h-4" fill="currentColor" /> Stop LFOs</> : <><Play className="w-4 h-4" fill="currentColor" /> Play LFOs</>}
              </button>
            )}
            {connected && (
              <button onClick={handleWave} disabled={busy} className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition disabled:opacity-50 ${waving ? 'bg-white/20 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'}`}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {waving ? 'Stop wave' : 'Wave'}
              </button>
            )}
            {connected && (
              <button onClick={handleRefresh} disabled={refreshing} title="Re-initialize the strips to recover a stuck flower" className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm bg-white/10 text-white/80 hover:bg-white/15 transition disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
              </button>
            )}
          </div>
          {reconnecting && <span className="flex items-center gap-2 text-xs text-amber-300/70"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reconnecting to flowers…</span>}
          {connected && !testMode && (
            <button onClick={async () => { reactorRef.current?.stop(); reactorRef.current = null; setSyncing(false); setLevel(0); if (modEngine.running) { modEngine.stop(); setRunning(false); } await disconnect(); setConnected(false); setWaving(false); }}
              className="flex items-center gap-2 text-xs text-white/45 hover:text-white/70 transition">
              <Bluetooth className="w-3.5 h-3.5" /> Disconnect
            </button>
          )}
          {!supported && <p className="text-xs text-amber-400/80 text-center max-w-xs">This browser doesn&apos;t support Web Bluetooth. Use Chrome on desktop or Android.</p>}
          {error && <p className="text-xs text-red-400/80 text-center max-w-xs">{error}</p>}
        </div>

        {/* Bottom: Patterns + One Shots (top) · LFO full-width below · macros + params */}
        <div className="flex flex-col gap-5">
          {/* Pattern + One-shot box (single, tabbed) */}
          <div className="w-full lg:max-w-lg"><PatternScreen /></div>

          {/* LFO module — full width, below the pattern boxes */}
          <div className="w-full min-w-0"><LfoModule /></div>

          {/* Macros + contextual parameters */}
          <div className="w-full lg:w-80 flex flex-col gap-4">
            {/* Macros */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-widest text-white/40">Macros</span>
              <div className="flex justify-between gap-2">
                {modEngine.macros.map((m, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <Knob value={m.base} onChange={(v) => { m.base = v; bump(); }} size={44} />
                    <div className="w-10 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-[#36d6c3]" style={{ width: `${Math.round((m.value || 0) * 100)}%` }} />
                    </div>
                    <select value={m.source} onChange={(e) => { m.source = e.target.value; bump(); }}
                      className="text-[9px] bg-black/40 rounded px-1 py-0.5 text-white/70 border border-white/10 max-w-[58px] outline-none" title={`${m.name} source`}>
                      <option value="" className="bg-zinc-900">{m.name}</option>
                      {LFO_OPTS.map((o) => <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Contextual parameters for the current selection */}
            <div className="rounded-2xl bg-white/[0.04] border border-white/8 p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{targetName(selected, layout)}</span>
                {selected !== 'all' && <button onClick={() => setSelected('all')} className="text-[11px] text-white/45 hover:text-white/80">All flowers</button>}
              </div>
              <span className="text-[10px] text-white/35 -mt-1">Tap a bouquet or flower above to target it.</span>

              {(() => {
                const tSel = modEngine.getTarget(selected);
                const tAll = modEngine.getTarget('all');
                const briVal = tSel.brightness.manual ?? tAll.brightness.manual ?? 100;
                const colVal = tSel.color.manual ?? tAll.color.manual ?? '#8b5cf6';
                const spdVal = tSel.speed.manual ?? tAll.speed.manual ?? 30;
                return (
                  <>
                    <ParamCard title="Brightness">
                      <input type="range" min="0" max="100" value={briVal}
                        onChange={(e) => { setParam('brightness', 'manual', Number(e.target.value)); if (selected === 'all') setBrightness(Number(e.target.value)); }}
                        className="w-full h-2 rounded-full appearance-none cursor-pointer"
                        style={{ accentColor: colVal, background: `linear-gradient(to right, ${colVal} ${briVal}%, rgba(255,255,255,0.12) ${briVal}%)` }} />
                      <SourceSelect sel={selected} name="brightness" bump={bump} />
                    </ParamCard>

                    <ParamCard title="Color">
                      <div className="flex flex-wrap items-center gap-2">
                        {SWATCHES.map((c) => (
                          <button key={c} onClick={() => { setParam('color', 'manual', c); if (selected === 'all') setColor(c); }} aria-label={`Color ${c}`}
                            className="w-6 h-6 rounded-full transition-transform"
                            style={{ background: c, transform: colVal.toLowerCase() === c.toLowerCase() ? 'scale(1.18)' : 'scale(1)', boxShadow: colVal.toLowerCase() === c.toLowerCase() ? `0 0 0 2px #000, 0 0 0 3px ${c}` : 'inset 0 0 0 1px rgba(255,255,255,0.15)' }} />
                        ))}
                        <label className="w-6 h-6 rounded-full cursor-pointer relative overflow-hidden" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} title="Custom color">
                          <input type="color" value={colVal} onChange={(e) => { setParam('color', 'manual', e.target.value); if (selected === 'all') setColor(e.target.value); }} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </label>
                      </div>
                      <SourceSelect sel={selected} name="color" bump={bump} />
                    </ParamCard>

                    <ParamCard title="Wave speed">
                      <input type="range" min="6" max="60" value={spdVal}
                        onChange={(e) => setParam('speed', 'manual', Number(e.target.value))}
                        className="w-full h-2 rounded-full appearance-none cursor-pointer"
                        style={{ accentColor: '#36d6c3', background: `linear-gradient(to right,#36d6c3 ${((spdVal - 6) / 54) * 100}%, rgba(255,255,255,0.12) ${((spdVal - 6) / 54) * 100}%)` }} />
                      <SourceSelect sel={selected} name="speed" bump={bump} />
                    </ParamCard>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Floating sync meters — kick + beat/BPM, shown while syncing with popup closed */}
      {syncing && !syncOpen && (
        <div className="fixed right-4 bottom-4 z-40 flex flex-col items-center gap-2 rounded-2xl bg-[#14171c]/90 backdrop-blur border border-white/10 px-3 py-3 shadow-xl">
          <SyncMeters kick={modEngine.kick} beatFill={beatFill} bpm={bpm} compact />
          <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: phaseCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: phaseCol }} /> {phaseLabel}
          </span>
        </div>
      )}

      {/* Sync to music popup */}
      {syncOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setSyncOpen(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-[#14171c] border border-white/10 p-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white flex items-center gap-2"><Settings className="w-4 h-4" /> Sync settings</span>
              <button onClick={() => setSyncOpen(false)} className="p-1 rounded hover:bg-white/10 text-white/50" aria-label="Close">✕</button>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-full bg-white/5 self-start">
              {[{ id: 'mic', label: 'Microphone', Icon: Mic }, { id: 'tab', label: 'Browser tab', Icon: MonitorSpeaker }].map(({ id, label, Icon }) => (
                <button key={id} onClick={() => !syncing && setAudioSource(id)} disabled={syncing}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs transition disabled:opacity-50 ${audioSource === id ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
            <button onClick={handleSyncToggle}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition ${syncing ? 'bg-white text-black' : 'bg-[#36d6c3] text-black hover:bg-[#36d6c3]/90'}`}>
              {syncing ? `Stop syncing · ${bpm} BPM` : 'Start syncing'}
            </button>
            {syncing && (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-black/30 border border-white/8 px-4 py-3">
                <SyncMeters kick={modEngine.kick} beatFill={beatFill} bpm={bpm} />
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-white/40">Section</span>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
                    style={{ color: phaseCol, borderColor: phaseCol, boxShadow: `0 0 12px ${phaseCol}` }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: phaseCol }} /> {phaseLabel}
                  </span>
                </div>
              </div>
            )}
            {/* On-device learning status — sections discovered so far + forget button */}
            <div className="flex items-center justify-between text-[11px] text-white/50">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#36d6c3] animate-pulse" />
                Learning · {phaseLearner.count} section{phaseLearner.count === 1 ? '' : 's'} · {kickModel.hits} kicks
              </span>
              <button onClick={() => { resetMusicModel(); bump(); }} className="text-white/40 hover:text-white/80 underline underline-offset-2">Reset</button>
            </div>
            {/* Auto light scenes — the detected section drives the pattern/color/kick punch */}
            <button onClick={() => modEngine.setAutoScene(!modEngine.autoScene)}
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${modEngine.autoScene ? 'bg-[#36d6c3]/15 border-[#36d6c3]/40' : 'bg-black/20 border-white/8 hover:border-white/20'}`}>
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Auto light scenes</span>
                <span className="text-[10px] text-white/45">Each section picks its own pattern, color &amp; kick punch.</span>
              </span>
              <span className={`flex-shrink-0 w-9 h-5 rounded-full p-0.5 transition ${modEngine.autoScene ? 'bg-[#36d6c3]' : 'bg-white/15'}`}>
                <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${modEngine.autoScene ? 'translate-x-4' : ''}`} />
              </span>
            </button>
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-[#36d6c3] transition-[width] duration-75" style={{ width: `${Math.min(100, Math.round(level * 140))}%` }} />
            </div>
            <p className="text-[11px] text-white/40 leading-relaxed">Listens to your music and tracks its BPM, kick &amp; sections. Anything set to “Sync to BPM” — a pattern&apos;s speed or an LFO&apos;s TEMPO — then follows the music automatically.</p>
            {audioSource === 'tab' && <p className="text-[10px] text-amber-300/60 leading-relaxed">Tab mode pauses Bluetooth when hidden — keep this window visible, or use Microphone.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
