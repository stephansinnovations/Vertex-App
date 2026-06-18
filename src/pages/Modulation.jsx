import React, { useReducer, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, Bluetooth, Loader2 } from 'lucide-react';
import { modEngine, PRESETS, PRESET_NAMES } from '@/api/modEngine';
import { onFlowerState, getFlowerState } from '@/api/flowerState';
import { isConnected, connectFlowers, onStatus, isBluetoothSupported } from '@/api/flowerBle';
import LfoEditor from '@/components/LfoEditor';

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
        {/* LFO editor with tabs */}
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5">
            {modEngine.lfos.map((l, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition whitespace-nowrap ${active === i ? 'bg-white/15 text-white' : 'bg-white/5 text-white/45 hover:text-white/75'}`}
              >
                {l.name}
              </button>
            ))}
          </div>
          <div className="flex-1 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Select
                value={lfo.preset}
                onChange={setPreset}
                options={PRESET_NAMES.map((n) => ({ value: n, label: n }))}
              />
              <span className="text-[10px] text-white/30">drag points · double-click to add/remove · drag ◇ to bend</span>
            </div>
            <LfoEditor points={lfo.points} onChange={setPoints} playhead={running ? lfo.phase : null} />
            <div className="flex gap-4">
              <Slider label="Rate" value={Number(lfo.rate.toFixed(2))} min={0.05} max={5} step={0.05} onChange={(v) => setLfo({ rate: v })} suffix=" Hz" />
              <Slider label="Smooth" value={Number(lfo.smooth.toFixed(2))} min={0} max={1} step={0.01} onChange={(v) => setLfo({ smooth: v })} />
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
