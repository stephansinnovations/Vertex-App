import React, { useState, useEffect, useRef, useCallback } from 'react';
import { OctagonX, CheckCircle2 } from 'lucide-react';
import { subscribeAgentActivity, cancelAgentTask } from '@/api/jarvisAgent';

// Global "stop coding" control. Always mounted; shows itself only while Jarvis is
// actually running a build (any entry point — Build view, chat tool loop, voice),
// so it's reachable no matter which screen you're on.
//
// Two ways to interrupt:
//   1. A prominent red button (tap = stop).
//   2. A voice listener that fires ONLY on the explicit phrases below — random
//      chatter must never halt a build, so we match whole, deliberate commands.

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

// Explicit commands only. Anything else is ignored — no accidental interrupts.
const STOP_PHRASES = ['stop coding', 'cancel build'];

export default function JarvisInterrupt() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false); // showing "Coding stopped"
  const [voiceArmed, setVoiceArmed] = useState(false);  // mic actively listening
  const confirmTimer = useRef(null);

  useEffect(() => subscribeAgentActivity(setBusy), []);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const handleStop = useCallback(async () => {
    await cancelAgentTask();
    setConfirming(true);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirming(false), 3500);
  }, []);

  // Voice listener — armed only while building (and never while Voice Mode owns
  // the mic, to avoid two recognizers fighting over the same audio).
  useEffect(() => {
    if (!busy || !SpeechRecognitionImpl) return;
    if (typeof window !== 'undefined' && window.__jarvisVoiceModeActive) return;

    let active = true;
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => { if (active) setVoiceArmed(true); };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const norm = (e.results[i][0].transcript || '')
          .toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (STOP_PHRASES.some(p => norm.includes(p))) { handleStop(); return; }
      }
    };
    // not-allowed / no-mic → silently rely on the button; no-speech/network → onend recovers.
    rec.onerror = () => {};
    rec.onend = () => { if (active) { try { rec.start(); } catch { /* ignore */ } } };
    try { rec.start(); } catch { /* ignore */ }

    return () => {
      active = false;
      setVoiceArmed(false);
      try { rec.abort(); } catch { /* ignore */ }
    };
  }, [busy, handleStop]);

  if (confirming) {
    return (
      <div className="fixed left-0 right-0 z-[70] flex justify-center px-3" style={{ top: 52 }}>
        <div className="flex items-center gap-2 rounded-full bg-emerald-600 text-white text-sm font-semibold px-4 py-2 shadow-xl"
          style={{ boxShadow: '0 8px 28px rgba(5,150,105,0.45)' }}>
          <CheckCircle2 className="w-4 h-4" /> Coding stopped.
        </div>
      </div>
    );
  }

  if (!busy) return null;

  return (
    <div className="fixed left-0 right-0 z-[70] flex justify-center px-3 pointer-events-none" style={{ top: 52 }}>
      <button
        onClick={handleStop}
        aria-label="Stop coding"
        className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white pl-3 pr-4 py-2 active:scale-95 transition"
        style={{ boxShadow: '0 8px 28px rgba(220,38,38,0.55)' }}
      >
        <span className="relative flex items-center justify-center w-5 h-5">
          <span className="absolute w-5 h-5 rounded-full bg-white/40 animate-ping" />
          <OctagonX className="w-5 h-5 relative" />
        </span>
        <span className="text-sm font-bold">Stop coding</span>
        {voiceArmed && (
          <span className="text-[11px] font-medium text-red-100/90 border-l border-white/30 pl-2 hidden sm:inline">
            or say “stop coding”
          </span>
        )}
      </button>
    </div>
  );
}
