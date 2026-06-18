import React, { useReducer, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Minus } from 'lucide-react';
import { modEngine, PRESETS, PRESET_NAMES, SYNC_NAMES, MODES, effectiveRate } from '@/api/modEngine';
import LfoEditor from '@/components/LfoEditor';
import Knob from '@/components/Knob';

const TEMPO_OPTIONS = ['free', ...SYNC_NAMES];
const clonePoints = (pts) => pts.map((p) => ({ x: p.x, y: p.y, curve: p.curve || 0 }));

// A labelled cell in the bottom control bar (content on top, caption below).
function Cell({ label, children }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-between gap-1 py-2 px-0.5 min-w-0">
      <div className="flex-1 flex items-center justify-center w-full">{children}</div>
      <span className="text-[9px] tracking-[0.15em] text-white/40">{label}</span>
    </div>
  );
}

// The Vital-style LFO module: LFO 1–4 tabs, toolbar, curve editor, and a bottom bar
// of MODE / TEMPO / SMOOTH / DELAY / STEREO. Edits modEngine directly.
export default function LfoModule() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const [active, setActive] = useState(0);
  useEffect(() => modEngine.subscribe(bump), []);

  const lfo = modEngine.lfos[active];
  const setLfo = (patch) => { Object.assign(modEngine.lfos[active], patch); bump(); };
  const setPoints = (pts) => { modEngine.lfos[active].points = pts; bump(); };
  const setPreset = (name) => { modEngine.lfos[active].preset = name; modEngine.lfos[active].points = clonePoints(PRESETS[name]); bump(); };

  return (
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

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Always-on BPM + live music level (top-right) */}
        <div className="absolute top-1.5 right-2 z-10 flex items-center gap-2 pointer-events-none">
          <span className="w-16 h-1.5 rounded-full bg-black/40 overflow-hidden">
            <span className="block h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.min(100, Math.round(modEngine.audioLevel * 140))}%`, background: '#36d6c3' }} />
          </span>
          <span className="text-[11px] tabular-nums text-white/75 font-medium">{modEngine.bpm} <span className="text-white/40">BPM</span></span>
        </div>
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-1.5 py-1.5 pr-24" style={{ background: '#1b1f26' }}>
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
        <LfoEditor points={lfo.points} onChange={setPoints} playhead={modEngine.running ? lfo.phase : null} gridX={lfo.gridX} />

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
          <Cell label="DELAY"><Knob value={lfo.delay} onChange={(v) => setLfo({ delay: v })} size={40} format={(v) => `${(v * 4).toFixed(2)} s`} /></Cell>
          <Cell label="STEREO"><Knob value={lfo.stereo} onChange={(v) => setLfo({ stereo: v })} size={40} /></Cell>
        </div>
      </div>
    </div>
  );
}
