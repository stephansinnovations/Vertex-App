import React, { useReducer, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, Bluetooth, Loader2, Mic, MonitorSpeaker, ChevronLeft, ChevronRight, Pencil, Minus } from 'lucide-react';
import { modEngine, PRESETS, PRESET_NAMES, SYNC_NAMES, MODES, effectiveRate } from '@/api/modEngine';
import { onFlowerState, getFlowerState } from '@/api/flowerState';
import { isConnected, connectFlowers, onStatus, isBluetoothSupported } from '@/api/flowerBle';
import { AudioReactor, BpmTracker } from '@/api/audioReactive';
import LfoEditor from '@/components/LfoEditor';
import Knob from '@/components/Knob';

const TEMPO_OPTIONS = ['free', ...SYNC_NAMES];

// A labelled cell in the bottom control bar (Vital-style: content on top, caption below).
function Cell({ label, children, className = '' }) {
  return (
    <div className={`flex-1 flex flex-col items-center justify-between gap-1 py-2 px-0.5 min-w-0 ${className}`}>
      <div className="flex-1 flex items-center justify-center w-full">{children}</div>
      <span className="text-[9px] tracking-[0.15em] text-white/40">{label}</span>
    </div>
  );
}

const clonePoints = (pts) => pts.map((p) => ({ x: p.x, y: p.y, curve: p.curve || 0 }));

// Source option lists.
const lfoOptions = modEngine.lfos.map((l, i) => ({ value: `lfo:${i}`, label: l.name }));
const macroOptions = modEngine.macros.map((m, i) => ({ value: `macro:${i}`, label: m.name }));

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-black/40 rounded-lg px-2 py-1.5 text-xs text-white outline-none border border-white/10 focus:border-white/30"
    >
      <option value="" className="bg-zinc-900">None</option>
      {options.map((o) => <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>)}
    </select>
  );
}

function Slider({ label, value, min, max, step, onChange, suffix }) {
  return (
    <label className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="flex justify-between text-[10px] uppercase tracking-wide text-white/40">
        <span>{label}</span><span className="text-white/60">{value}{suffix}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: '#36d6c3', background: `linear-gradient(to right,#36d6c3 ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.12) ${((value - min) / (max - min)) * 100}%)` }}
      />
    </label>
  );
}

export default function Modulation() {
  const navigate = useNavigate();
  const [, bump] = useReducer((x) => x + 1, 0);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(modEngine.running);
  const [connected, setConnected] = useState(isConnected());
  const [connecting, setConnecting] = useState(false);
  const [live, setLive] = useState(getFlowerState());
  const [detecting, setDetecting] = useState(false);
  const [detectSource, setDetectSource] = useState('mic');
  const [detectErr, setDetectErr] = useState('');
  const reactorRef = useRef(null);

  // Re-render on engine ticks (live playhead + macro/param meters) and flower state.
  useEffect(() => modEngine.subscribe(bump), []);
  useEffect(() => onFlowerState(setLive), []);
  useEffect(() => { const s = () => setConnected(isConnected()); s(); return onStatus(s); }, []);
  useEffect(() => () => { /* leave engine running if user started it */ }, []);

  const lfo = modEngine.lfos[active];

  const setLfo = (patch) => { Object.assign(modEngine.lfos[active], patch); bump(); };
  const setPoints = (pts) => { modEngine.lfos[active].points = pts; bump(); };
  const setPreset = (name) => { modEngine.lfos[active].preset = name; modEngine.lfos[active].points = clonePoints(PRESETS[name]); bump(); };

  const toggleRun = () => {
    if (modEngine.running) { modEngine.stop(); setRunning(false); }
    else { modEngine.start(); setRunning(true); }
  };

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try { await connectFlowers(); setConnected(true); } catch { /* ignore */ } finally { setConnecting(false); }
  }, []);

  const toggleDetect = useCallback(async () => {
    setDetectErr('');
    if (detecting) {
      reactorRef.current?.stop();
      reactorRef.current = null;
      setDetecting(false);
      return;
    }
    try {
      const tracker = new BpmTracker();
      const reactor = new AudioReactor();
      reactor.onFrame = ({ beat }) => { if (beat) { modEngine.bpm = tracker.push(performance.now()); modEngine.onBeat(); bump(); } };
      reactor.onEnded = () => { setDetecting(false); reactorRef.current = null; };
      await reactor.start(detectSource);
      reactorRef.current = reactor;
      setDetecting(true);
    } catch (e) {
      setDetectErr(/denied|NotAllowed/i.test(e?.message || '') ? 'Audio permission denied.' : (e?.message || 'Could not listen.'));
    }
  }, [detecting, detectSource]);

  useEffect(() => () => { reactorRef.current?.stop(); }, []);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#0a0a12] via-[#0d0a1a] to-black text-white flex flex-col">
      {/* Header */}
      <div className="relative flex items-center justify-center px-4 py-5">
        <button onClick={() => navigate(-1)} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition" aria-label="Back">
          <ArrowLeft className="w-6 h-6 text-white/80" />
        </button>
        <h1 className="text-lg font-semibold tracking-[0.25em] uppercase text-white/90">Modulation</h1>
      </div>

      <div className="flex-1 w-full max-w-2xl mx-auto px-4 pb-24 flex flex-col gap-5">
        {/* ── LFO module (Vital-style) ── */}
        <div className="rounded-xl overflow-hidden border border-black/50 flex" style={{ background: '#0f1216' }}>
          {/* LFO tabs */}
          <div className="flex flex-col w-12 flex-shrink-0" style={{ background: '#14171c' }}>
            {modEngine.lfos.map((l, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`flex-1 flex items-center justify-center text-[11px] font-medium border-b border-black/40 transition ${active === i ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                style={{ background: active === i ? '#0f1216' : 'transparent' }}
              >
                LFO {i + 1}
              </button>
            ))}
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-1.5 py-1.5" style={{ background: '#1b1f26' }}>
              <span className="p-1 rounded bg-white/10 text-white/85"><Pencil className="w-3.5 h-3.5" /></span>
              <span className="p-1 rounded text-white/35" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeOpacity="0.5" fill="none" /><path d="M2.5 11 L11.5 3" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
              </span>
              <button
                onClick={() => { const o = [4, 8, 16, 32]; setLfo({ gridX: o[(o.indexOf(lfo.gridX) + 1) % o.length] || 8 }); }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/30 text-[11px] text-white/70 tabular-nums"
                title="Grid divisions"
              >
                {lfo.gridX} <Minus className="w-2.5 h-2.5 text-white/40" /> 1
              </button>
              <span className="p-1 rounded text-white/35" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 9 Q4 3 7 7 T13 5" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
              </span>
              <div className="flex-1 flex items-center justify-center gap-2">
                <button onClick={() => { const i = PRESET_NAMES.indexOf(lfo.preset); setPreset(PRESET_NAMES[(i - 1 + PRESET_NAMES.length) % PRESET_NAMES.length]); }} className="text-white/50 hover:text-white" aria-label="Previous shape"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-xs text-white/85 min-w-[56px] text-center truncate">{lfo.preset}</span>
                <button onClick={() => { const i = PRESET_NAMES.indexOf(lfo.preset); setPreset(PRESET_NAMES[(i + 1) % PRESET_NAMES.length]); }} className="text-white/50 hover:text-white" aria-label="Next shape"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Graph */}
            <LfoEditor points={lfo.points} onChange={setPoints} playhead={running ? lfo.phase : null} gridX={lfo.gridX} />

            {/* Bottom control bar */}
            <div className="flex divide-x divide-black/40" style={{ background: '#1b1f26' }}>
              <Cell label="MODE">
                <button onClick={() => { const i = MODES.indexOf(lfo.mode); setLfo({ mode: MODES[(i + 1) % MODES.length] }); }} className="px-1.5 py-1.5 rounded bg-black/30 text-[11px] text-white/85 w-full truncate">
                  {lfo.mode}
                </button>
              </Cell>
              <Cell label="TEMPO">
                <button
                  onClick={() => { const i = TEMPO_OPTIONS.indexOf(lfo.sync); setLfo({ sync: TEMPO_OPTIONS[(i + 1) % TEMPO_OPTIONS.length] }); }}
                  onWheel={(e) => { if (lfo.sync === 'free') setLfo({ rate: Math.max(0.05, Math.min(5, lfo.rate - Math.sign(e.deltaY) * 0.05)) }); }}
                  title={`${effectiveRate(lfo, modEngine.bpm).toFixed(2)} Hz`}
                  className="px-1.5 py-1.5 rounded bg-black/30 text-[11px] text-white/85 flex items-center gap-1 w-full justify-center truncate"
                >
                  {lfo.sync === 'free' ? `${lfo.rate.toFixed(2)}Hz` : lfo.sync}
                  <span className="text-white/50">&#9834;</span>
                </button>
              </Cell>
              <Cell label="SMOOTH"><Knob value={lfo.smooth} onChange={(v) => setLfo({ smooth: v })} size={40} /></Cell>
              <Cell label="DELAY"><Knob value={lfo.delay} onChange={(v) => setLfo({ delay: v })} size={40} /></Cell>
              <Cell label="STEREO"><Knob value={lfo.stereo} onChange={(v) => setLfo({ stereo: v })} size={40} /></Cell>
            </div>
          </div>
        </div>

        {/* Live output preview */}
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] border border-white/8 p-3">
          <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ background: live.color, opacity: Math.max(0.12, (live.brightness ?? 100) / 100), boxShadow: `0 0 14px ${live.color}` }} />
          <div className="flex-1">
            <div className="text-xs text-white/50">Live output</div>
            <div className="h-1.5 mt-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${live.brightness ?? 0}%`, background: live.color }} />
            </div>
          </div>
          <button onClick={toggleRun} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition ${running ? 'bg-white text-black' : 'bg-[#36d6c3]/90 text-black hover:bg-[#36d6c3]'}`}>
            {running ? <><Square className="w-4 h-4" fill="currentColor" /> Stop</> : <><Play className="w-4 h-4" fill="currentColor" /> Play</>}
          </button>
        </div>

        {/* Tempo */}
        <div className="rounded-2xl bg-white/[0.04] border border-white/8 p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-white/40">Tempo</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={modEngine.bpm}
                onChange={(e) => { modEngine.bpm = Math.max(20, Math.min(300, Number(e.target.value) || 120)); bump(); }}
                className="w-16 bg-black/40 rounded-lg px-2 py-1 text-sm text-white text-center outline-none border border-white/10 focus:border-white/30"
              />
              <span className="text-xs text-white/50">BPM</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 rounded-full bg-white/5">
              {[{ id: 'mic', Icon: Mic }, { id: 'tab', Icon: MonitorSpeaker }].map(({ id, Icon }) => (
                <button
                  key={id}
                  onClick={() => !detecting && setDetectSource(id)}
                  disabled={detecting}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs transition disabled:opacity-50 ${detectSource === id ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {id === 'mic' ? 'Mic' : 'Tab'}
                </button>
              ))}
            </div>
            <button
              onClick={toggleDetect}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold transition ${detecting ? 'bg-[#36d6c3] text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              {detecting ? `Listening… ${modEngine.bpm} BPM` : 'Detect from music'}
            </button>
            {detectErr && <span className="text-[11px] text-red-400/80">{detectErr}</span>}
          </div>
          <p className="text-[11px] text-white/35">Set an LFO&apos;s Sync to 1 bar / 1&frasl;2 / 1&frasl;4… and it locks to this tempo.</p>
        </div>

        {/* Macros */}
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-widest text-white/40">Macros</span>
          {modEngine.macros.map((m, i) => (
            <div key={i} className="rounded-2xl bg-white/[0.04] border border-white/8 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-white/85 w-16">{m.name}</span>
                <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-[#36d6c3]" style={{ width: `${Math.round(m.value * 100)}%` }} />
                </div>
                <span className="text-xs tabular-nums text-white/50 w-9 text-right">{Math.round(m.value * 100)}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-16 text-[10px] uppercase tracking-wide text-white/35">Driven by</div>
                <Select value={m.source} onChange={(v) => { m.source = v; bump(); }} options={lfoOptions} />
                <div className="flex-1">
                  <Slider label="Amount" value={Number(m.amount.toFixed(2))} min={0} max={1} step={0.01} onChange={(v) => { m.amount = v; bump(); }} />
                </div>
                <div className="w-28">
                  <Slider label="Base" value={Number(m.base.toFixed(2))} min={0} max={1} step={0.01} onChange={(v) => { m.base = v; bump(); }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Parameter routing */}
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-widest text-white/40">Map parameters</span>
          {[
            { key: 'brightness', label: 'Brightness' },
            { key: 'color', label: 'Color' },
            { key: 'speed', label: 'Wave speed' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] border border-white/8 p-3">
              <span className="text-sm font-medium text-white/85 flex-1">{label}</span>
              <span className="text-[10px] uppercase tracking-wide text-white/35">Source</span>
              <Select
                value={modEngine.params[key].source}
                onChange={(v) => { modEngine.params[key].source = v; bump(); }}
                options={[...macroOptions, ...lfoOptions]}
              />
            </div>
          ))}
        </div>

        {/* Connection note */}
        {!connected && (
          <button
            onClick={handleConnect}
            disabled={connecting || !isBluetoothSupported()}
            className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-sm transition disabled:opacity-50"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />}
            {connecting ? 'Connecting…' : 'Connect flowers to drive them live'}
          </button>
        )}
        <p className="text-[11px] text-white/35 text-center">
          Press Play to run the LFOs. Map Brightness / Color / Wave&nbsp;speed to a Macro or LFO above —
          the visualization and your flowers follow it live.
        </p>
      </div>
    </div>
  );
}
