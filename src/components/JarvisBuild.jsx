import React, { useState, useRef, useEffect } from 'react';
import { X, Send, ShieldCheck, ExternalLink, Loader2, Hammer } from 'lucide-react';

// Jarvis Build — talks to the Jarvis Agent backend (~/jarvis-agent) so Jarvis
// can actually edit + deploy the app. Streams the agent's progress, pops a
// password prompt when it needs to run a risky command, and links the preview
// branch Vercel builds. Config (URL + secret) lives in localStorage per device
// — the secret grants code execution, so it never goes near shared storage.

const LS_URL = 'jarvis_agent_url';
const LS_SECRET = 'jarvis_agent_secret';
const REPO_WEB = 'https://github.com/stephansinnovations/Vertex-App';

const trim = (u) => u.replace(/\/+$/, '');

async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop();
    for (const f of frames) {
      const line = f.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore keep-alives */ }
    }
  }
}

export default function JarvisBuild({ isOpen, onClose }) {
  const [url, setUrl] = useState(() => localStorage.getItem(LS_URL) || '');
  const [secret, setSecret] = useState(() => localStorage.getItem(LS_SECRET) || '');
  const [needsSetup, setNeedsSetup] = useState(() => !(localStorage.getItem(LS_URL) && localStorage.getItem(LS_SECRET)));

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState(null); // { id, command, tool }
  const [password, setPassword] = useState('');

  const sessionRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => { if (isOpen) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); }, [messages, isOpen]);

  const push = (m) => setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, ...m }]);

  const saveConfig = () => {
    if (!url.trim() || !secret.trim()) return;
    localStorage.setItem(LS_URL, trim(url.trim()));
    localStorage.setItem(LS_SECRET, secret.trim());
    setNeedsSetup(false);
  };

  const handleEvent = (ev) => {
    switch (ev.kind) {
      case 'status': push({ type: 'status', text: ev.text }); break;
      case 'say': push({ type: 'say', text: ev.text }); break;
      case 'tool': push({ type: 'tool', text: ev.input ? `${ev.name} · ${ev.input}` : ev.name }); break;
      case 'approval': setPending({ id: ev.id, command: ev.command, tool: ev.tool }); break;
      case 'done':
        if (ev.sessionId) sessionRef.current = ev.sessionId;
        push({ type: 'done', text: ev.text, branch: ev.branch, changed: ev.changed });
        break;
      case 'error': push({ type: 'error', text: ev.text }); break;
      default: break;
    }
  };

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || running) return;
    setInput('');
    push({ type: 'user', text: prompt });
    setRunning(true);
    try {
      const res = await fetch(`${trim(url)}/jarvis`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({ prompt, sessionId: sessionRef.current || undefined }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        push({ type: 'error', text: `Agent ${res.status}${t ? ` — ${t.slice(0, 200)}` : ''}` });
        return;
      }
      await readSSE(res.body, handleEvent);
    } catch (e) {
      push({ type: 'error', text: `Couldn't reach the Jarvis Agent: ${e?.message || e}. Is the server + tunnel running?` });
    } finally {
      setRunning(false);
    }
  };

  const respond = async (approve) => {
    const a = pending; const pw = password;
    setPending(null); setPassword('');
    if (!a) return;
    try {
      await fetch(`${trim(url)}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify(approve ? { id: a.id, password: pw } : { id: a.id, deny: true }),
      });
    } catch { /* the job stream will surface a denial/timeout */ }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #0d1a2e 0%, #05070d 60%, #000 100%)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-14 pb-3 border-b border-white/10 flex-shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'radial-gradient(circle at 35% 28%, rgba(186,230,253,0.95), rgba(2,132,199,0.95))' }}>
          <Hammer className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm">Jarvis · Build</p>
          <p className="text-sky-300/70 text-xs">{running ? 'Working…' : 'Edits & deploys your app'}</p>
        </div>
        {!needsSetup && (
          <button onClick={() => setNeedsSetup(true)} className="text-white/50 hover:text-white text-xs px-2 py-1">Setup</button>
        )}
        <button onClick={onClose} className="text-white/60 hover:text-white p-1"><X className="w-5 h-5" /></button>
      </div>

      {needsSetup ? (
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 max-w-md mx-auto w-full">
          <p className="text-white/80 text-sm leading-relaxed">
            Connect to your Jarvis Agent — the server on your Mac that lets Jarvis code the app.
            Start it (<code className="text-sky-300">npm start</code> in <code className="text-sky-300">~/jarvis-agent</code>)
            and a Cloudflare tunnel, then paste its URL + secret here.
          </p>
          <div>
            <label className="text-xs text-white/50 mb-1 block">Agent URL</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://something.trycloudflare.com"
              className="w-full bg-black/40 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1 block">Agent secret (JARVIS_SECRET)</label>
            <input value={secret} onChange={e => setSecret(e.target.value)} type="password" placeholder="from ~/jarvis-agent/.env"
              className="w-full bg-black/40 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-sky-400" />
          </div>
          <button onClick={saveConfig} disabled={!url.trim() || !secret.trim()}
            className="w-full bg-sky-500 text-white font-semibold py-3 rounded-xl disabled:opacity-40">
            Connect
          </button>
        </div>
      ) : (
        <>
          {/* Transcript */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
            {messages.length === 0 && (
              <div className="text-center pt-10 text-white/50 text-sm px-8">
                Tell Jarvis what to build or change. He'll edit the code, run the build, and push a preview you can approve.
              </div>
            )}
            {messages.map(m => <BuildBubble key={m.id} m={m} />)}
            {running && (
              <div className="flex items-center gap-2 text-sky-300/70 text-xs px-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Jarvis is on it…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-white/10 flex-shrink-0 flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="e.g. Add a dark-mode toggle to the home screen"
              rows={1}
              disabled={running}
              className="flex-1 bg-black/40 border border-white/15 rounded-2xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-sky-400 resize-none"
              style={{ maxHeight: 120 }}
            />
            <button onClick={send} disabled={running || !input.trim()}
              className="p-2.5 rounded-2xl flex-shrink-0 bg-sky-500 text-white disabled:opacity-30">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {/* Password approval */}
      {pending && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-400/30 bg-zinc-900 p-5 space-y-4">
            <div className="flex items-center gap-2 text-amber-300">
              <ShieldCheck className="w-5 h-5" />
              <p className="font-semibold text-sm">Jarvis needs approval to run this</p>
            </div>
            <pre className="text-xs text-amber-100 bg-black/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">{pending.command}</pre>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoFocus
              onKeyDown={e => { if (e.key === 'Enter') respond(true); }}
              placeholder="Override password"
              className="w-full bg-black/40 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-400" />
            <div className="flex gap-2">
              <button onClick={() => respond(true)} disabled={!password}
                className="flex-1 bg-amber-500 text-black font-semibold py-2.5 rounded-xl disabled:opacity-40">Allow once</button>
              <button onClick={() => respond(false)}
                className="px-5 py-2.5 rounded-xl border border-white/15 text-white/80">Deny</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BuildBubble({ m }) {
  if (m.type === 'user') return (
    <div className="flex justify-end"><div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm bg-sky-500 text-white whitespace-pre-wrap">{m.text}</div></div>
  );
  if (m.type === 'say') return (
    <div className="max-w-[88%] px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm bg-white/10 text-white/90 whitespace-pre-wrap">{m.text}</div>
  );
  if (m.type === 'status') return (
    <div className="text-xs text-sky-300/70 px-2">{m.text}</div>
  );
  if (m.type === 'tool') return (
    <div className="text-xs text-white/45 font-mono px-2 truncate">🔧 {m.text}</div>
  );
  if (m.type === 'error') return (
    <div className="max-w-[88%] px-4 py-2.5 rounded-2xl text-sm bg-red-900/60 text-red-200 whitespace-pre-wrap">{m.text}</div>
  );
  if (m.type === 'done') return (
    <div className="max-w-[90%] rounded-2xl rounded-tl-sm p-4 bg-white/10 border border-white/10 space-y-2">
      <p className="text-sm text-white/90 whitespace-pre-wrap">{m.text}</p>
      {m.changed && m.branch && m.branch !== 'main' && (
        <a href={`${REPO_WEB}/tree/${m.branch}`} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200">
          <ExternalLink className="w-3.5 h-3.5" /> Preview branch: {m.branch} (Vercel is building it)
        </a>
      )}
      {m.changed && m.branch === 'main' && (
        <p className="text-xs text-sky-300/80">Pushed to main — deploying live.</p>
      )}
    </div>
  );
  return null;
}
