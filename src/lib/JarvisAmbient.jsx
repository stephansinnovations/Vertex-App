import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  callClaude, execTool, TOOLS, buildSystemPrompt, buildVoiceSystemPrompt, pickVoice,
} from '@/components/VertexChat';
import { ApprovalModal } from '@/components/JarvisBuild';
import { runAgentTask, isAgentConfigured, approveAgentCommand, REPO_WEB } from '@/api/jarvisAgent';
import { loadDisplay, saveDisplay, loadApi, saveApi } from '@/lib/vertexChatStorage';

// Ambient Jarvis — the always-on voice entity. Toggle it (the floating orb) and
// Jarvis listens/talks over whatever page you're on: no takeover screen, just a
// glow + a thin caption strip. Same brain as the chat (shared tools, shared
// 'home' history) — one Jarvis. Big coding jobs go to the Jarvis Agent with
// spoken milestones; risky commands pop the password approval.

const AMBIENT_CTX = 'home'; // ambient turns share the main Jarvis chat history

const Ctx = createContext({ enabled: false, status: 'off', toggle: () => {} });
export const useJarvisAmbient = () => useContext(Ctx);

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

// Persist ambient turns into the shared chat storage so the chat view shows them.
function commitTurn(userText, aiText) {
  const stamp = Date.now();
  saveDisplay(AMBIENT_CTX, [...loadDisplay(AMBIENT_CTX),
    { id: stamp + 'au', type: 'user', text: userText },
    { id: stamp + 'aa', type: 'ai', text: aiText }]);
  saveApi(AMBIENT_CTX, [...loadApi(AMBIENT_CTX),
    { role: 'user', content: userText },
    { role: 'assistant', content: aiText }]);
}
function commitDisplay(item) {
  saveDisplay(AMBIENT_CTX, [...loadDisplay(AMBIENT_CTX), { id: `${Date.now()}-${Math.random()}`, ...item }]);
}

export function JarvisAmbientProvider({ children }) {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('off'); // off|listening|thinking|speaking|building|blocked|unsupported
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [recent, setRecent] = useState([]); // last few {who, text}
  const [pendingApproval, setPendingApproval] = useState(null);
  const [password, setPassword] = useState('');

  const navRef = useRef(navigate); navRef.current = navigate;
  const agentSessionRef = useRef(null);

  const pushRecent = useCallback((who, text) => {
    setRecent(prev => [...prev, { who, text }].slice(-6));
  }, []);

  // The engine lives in one effect keyed on `enabled` — same persistent-recognizer
  // pattern as the chat's VoiceMode (that design survived the mic races).
  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    let active = true;
    if (!SR) { setStatus('unsupported'); return; }
    // Ambient owns the mic — tell JarvisInterrupt's voice listener to stand down
    // so two recognizers never fight over the same audio.
    window.__jarvisVoiceModeActive = true;

    // Seed conversation from the shared history (text-only, merged, user-first).
    const toText = (c) => typeof c === 'string' ? c
      : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ').trim() : '';
    const workingApi = [];
    for (const m of loadApi(AMBIENT_CTX)) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = toText(m.content);
      if (!text) continue;
      const last = workingApi[workingApi.length - 1];
      if (last && last.role === m.role) last.content += `\n${text}`;
      else workingApi.push({ role: m.role, content: text });
    }
    while (workingApi.length && workingApi[0].role !== 'user') workingApi.shift();

    const voiceSystem = buildVoiceSystemPrompt(buildSystemPrompt(AMBIENT_CTX, 'direct'));
    const names = new Set(['build_app', 'list_rooms', 'list_agents', 'get_conversation', 'navigate_to']);
    const voiceTools = TOOLS.filter(t => names.has(t.name));

    let voice = pickVoice();
    const onVoices = () => { voice = pickVoice(); };
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = onVoices;

    let mode = 'idle';
    let rec = null;
    let pending = '';
    let interimTxt = '';
    let silenceTimer = null;

    const setStat = (s) => { if (active) setStatus(s); };

    function speak(text, resume = true) {
      mode = 'speaking';
      setStat('speaking');
      if (active) { setSaid(text); pushRecent('jarvis', text); }
      const synth = window.speechSynthesis;
      if (!synth) { if (resume) startListening(); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.02;
      let done = false;
      const finish = () => { if (done) return; done = true; if (active && resume) startListening(); };
      u.onend = finish;
      u.onerror = finish;
      setTimeout(finish, Math.min(20000, 1600 + text.length * 60));
      synth.speak(u);
    }

    // Milestone-style build runner: speak start / approval / done; write the
    // detail into the shared chat transcript.
    async function runBuild(task) {
      if (!isAgentConfigured()) {
        return "Build isn't connected — open the chat's hammer icon and add the agent URL and secret first.";
      }
      mode = 'building';
      setStat('building');
      speak("On it. I'll let you know when it's done.", false); // don't resume mic during the build
      commitDisplay({ type: 'buildstep', text: `🔨 Building: ${task}` });
      try {
        const result = await runAgentTask({
          prompt: task,
          sessionId: agentSessionRef.current,
          onEvent: (ev) => {
            if (ev.kind === 'status') commitDisplay({ type: 'buildstep', text: ev.text });
            else if (ev.kind === 'say') commitDisplay({ type: 'ai', text: ev.text });
            else if (ev.kind === 'tool') commitDisplay({ type: 'buildstep', text: `🔧 ${ev.input ? `${ev.name} · ${ev.input}` : ev.name}`, mono: true });
            else if (ev.kind === 'approval') {
              if (active) {
                setPendingApproval({ id: ev.id, command: ev.command });
                speak('I need your password to approve a command — it is on screen.', false);
              }
            } else if (ev.kind === 'error') commitDisplay({ type: 'ai', text: ev.text, isError: true });
          },
        });
        agentSessionRef.current = result.sessionId || agentSessionRef.current;
        if (result.stopped) {
          commitDisplay({ type: 'buildstep', text: '⏹ Coding stopped.' });
          return 'The build was stopped before finishing.';
        }
        commitDisplay({ type: 'deploy', branch: result.branch, changed: result.changed, text: result.summary || 'Done.' });
        return result.changed
          ? `Build complete. Pushed to ${result.branch === 'main' ? 'main, deploying live' : 'a preview branch — check the chat for the link'}. ${result.summary?.slice(0, 300) || ''}`
          : `No code changes were needed. ${result.summary?.slice(0, 300) || ''}`;
      } catch (e) {
        commitDisplay({ type: 'ai', text: `Build failed: ${e?.message || e}`, isError: true });
        return `The build failed: ${e?.message || e}`;
      }
    }

    async function handleUtterance(text) {
      mode = 'thinking';
      setStat('thinking');
      if (active) { setHeard(text); pushRecent('you', text); }
      clearTimeout(silenceTimer);
      try { rec && rec.stop(); } catch { /* paused while thinking/speaking */ }
      workingApi.push({ role: 'user', content: text });
      try {
        for (let guard = 0; guard < 6; guard++) {
          const resp = await callClaude(workingApi, voiceSystem, voiceTools, 'claude-haiku-4-5');
          if (resp.stop_reason === 'tool_use') {
            workingApi.push({ role: 'assistant', content: resp.content });
            const results = [];
            for (const b of resp.content.filter(x => x.type === 'tool_use')) {
              if (b.name === 'build_app') {
                const summary = await runBuild(b.input.task);
                results.push({ type: 'tool_result', tool_use_id: b.id, content: summary });
              } else {
                const out = await execTool(b.name, b.input, { navigate: navRef.current });
                results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
              }
            }
            workingApi.push({ role: 'user', content: results });
            continue;
          }
          const reply = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
            || "Sorry, I didn't catch that.";
          workingApi.push({ role: 'assistant', content: reply });
          commitTurn(text, reply);
          if (active) speak(reply);
          break;
        }
      } catch (err) {
        const detail = err?.message || 'unknown error';
        const spoken = /api key/i.test(detail)
          ? 'I need an Anthropic API key in Settings before I can answer.'
          : 'Something went wrong reaching the server.';
        if (active) { setSaid(`${spoken} (${detail.slice(0, 160)})`); speak(spoken); }
      }
    }

    function trySend() {
      const text = `${pending} ${interimTxt}`.trim();
      if (text && mode === 'listening') { pending = ''; interimTxt = ''; handleUtterance(text); }
    }

    function ensureRec() {
      if (rec) return rec;
      rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = '', finalChunk = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalChunk += t; else interim += t;
        }
        if (finalChunk) pending = `${pending} ${finalChunk}`.trim();
        interimTxt = interim;
        if (active) setHeard(`${pending} ${interim}`.trim());
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(trySend, 1100);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { mode = 'blocked'; setStat('blocked'); }
      };
      rec.onend = () => { if (active && mode === 'listening') { try { rec.start(); } catch { /* already running */ } } };
      return rec;
    }

    function startListening() {
      if (!active) return;
      mode = 'listening';
      pending = ''; interimTxt = '';
      setStat('listening');
      if (active) setHeard('');
      const r = ensureRec();
      try { r.start(); } catch { /* already running */ }
    }

    const bootT = setTimeout(() => { if (active) speak("I'm here."); }, 300);

    return () => {
      active = false;
      window.__jarvisVoiceModeActive = false;
      clearTimeout(bootT);
      clearTimeout(silenceTimer);
      try { rec && rec.abort(); } catch { /* gone */ }
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* gone */ }
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, [enabled, pushRecent]);

  const toggle = useCallback(() => {
    setEnabled(v => !v);
    setHeard(''); setSaid(''); setRecent([]); setExpanded(false);
  }, []);

  const respondApproval = async (approve) => {
    const a = pendingApproval; const pw = password;
    setPendingApproval(null); setPassword('');
    if (!a) return;
    try { await approveAgentCommand(approve ? { id: a.id, password: pw } : { id: a.id, deny: true }); } catch { /* stream surfaces it */ }
  };

  const STATUS_LABEL = {
    listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…',
    building: 'Building…', blocked: 'Microphone blocked', unsupported: 'Voice needs Chrome',
  };

  return (
    <Ctx.Provider value={{ enabled, status, toggle }}>
      {children}

      {/* Caption strip — thin, above the floating orb; tap to expand recent turns */}
      {enabled && (
        <div className="fixed left-3 right-3 z-40" style={{ bottom: 96 }}>
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full text-left rounded-2xl px-4 py-2.5 backdrop-blur-md border"
            style={{ background: 'rgba(5,12,24,0.82)', borderColor: 'rgba(56,189,248,0.25)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}
          >
            {expanded && recent.length > 1 && (
              <div className="mb-2 space-y-1 max-h-40 overflow-y-auto">
                {recent.slice(0, -1).map((r, i) => (
                  <p key={i} className="text-xs leading-snug" style={{ color: r.who === 'you' ? '#7dd3fc' : 'rgba(255,255,255,0.75)' }}>
                    <span className="opacity-60">{r.who === 'you' ? 'you: ' : 'Jarvis: '}</span>{r.text}
                  </p>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'listening' ? 'bg-sky-400 animate-pulse' : status === 'building' ? 'bg-amber-400 animate-pulse' : status === 'blocked' || status === 'unsupported' ? 'bg-red-400' : 'bg-sky-200'}`} />
              <p className="text-xs font-medium text-sky-300/90 flex-shrink-0">{STATUS_LABEL[status] || 'Jarvis'}</p>
              <p className="text-xs text-white/80 truncate">
                {status === 'listening' && heard ? `“${heard}”` : said || (status === 'blocked' ? 'Allow the mic in the address bar, then toggle me again.' : '')}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Password approval for risky agent commands */}
      {pendingApproval && (
        <ApprovalModal pending={pendingApproval} password={password} setPassword={setPassword} onRespond={respondApproval} />
      )}
    </Ctx.Provider>
  );
}

export { REPO_WEB };
