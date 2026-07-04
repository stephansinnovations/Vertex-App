// Shared client for the Jarvis Agent backend (~/jarvis-agent). Used by both the
// dedicated Build view (JarvisBuild) and the conversational/voice Jarvis (via the
// build_app tool) so coding tasks all flow through one place — one Jarvis.
//
// Config (URL + secret) lives in localStorage per device. The secret grants code
// execution, so it never goes near shared storage.

import { supabase } from '@/api/supabaseClient';

const LS_URL = 'jarvis_agent_url';
const LS_SECRET = 'jarvis_agent_secret';
export const REPO_WEB = 'https://github.com/stephansinnovations/Vertex-App';

const clean = (u) => (u || '').replace(/\/+$/, '');

export function getAgentConfig() {
  return { url: clean(localStorage.getItem(LS_URL)), secret: localStorage.getItem(LS_SECRET) || '' };
}

// The tunnel's URL changes whenever it restarts, so the agent publishes its
// current one to shared_state (key 'jarvis_agent') and we prefer that. Falls
// back to whatever was last saved locally. Only the URL lives in shared
// storage — the secret stays on this device.
async function resolveAgentUrl() {
  try {
    const { data } = await supabase.from('shared_state').select('value').eq('key', 'jarvis_agent').maybeSingle();
    const url = clean(data?.value?.url || '');
    if (url) { localStorage.setItem(LS_URL, url); return url; }
  } catch { /* offline / table missing — use the cached one */ }
  return clean(localStorage.getItem(LS_URL));
}
export function setAgentConfig(url, secret) {
  localStorage.setItem(LS_URL, clean(url));
  localStorage.setItem(LS_SECRET, secret);
}
export function isAgentConfigured() {
  const c = getAgentConfig();
  return !!(c.url && c.secret);
}

// ── Interrupt / activity tracking ────────────────────────────────────────────
// One Jarvis, several entry points (Build view, chat tool loop, voice) — so we
// track every in-flight coding task in one place. That lets a single "stop
// coding" halt them all, and lets the UI show a global interrupt control that's
// visible only while a build is actually running.
const activeTasks = new Set();        // AbortControllers of running tasks
const activityListeners = new Set();  // cb(busy:boolean)

function emitActivity() {
  const busy = activeTasks.size > 0;
  for (const cb of activityListeners) { try { cb(busy); } catch { /* ignore */ } }
}

// Subscribe to "is Jarvis building right now?". Fires immediately with the
// current state, returns an unsubscribe.
export function subscribeAgentActivity(cb) {
  activityListeners.add(cb);
  try { cb(activeTasks.size > 0); } catch { /* ignore */ }
  return () => activityListeners.delete(cb);
}

export function isAgentBusy() {
  return activeTasks.size > 0;
}

// Hard-stop every in-flight coding task. Aborts the local streams immediately
// (the build view / chat see a clean "stopped" result) and best-effort tells the
// backend to halt the actual process — ignored if the agent has no /stop route.
// Safe to call when nothing is running; returns whether anything was stopped.
export async function cancelAgentTask() {
  const had = activeTasks.size > 0;
  for (const ctrl of [...activeTasks]) { try { ctrl.abort(); } catch { /* ignore */ } }
  activeTasks.clear();
  emitActivity();
  const { secret } = getAgentConfig();
  const url = await resolveAgentUrl();
  if (url && secret) {
    // Fire-and-forget — don't block the UI, and don't surface a 404 if the
    // backend predates the /stop route (the client-side abort already halted us).
    fetch(`${url}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    }).catch(() => {});
  }
  return had;
}

// Send a coding task to the agent and stream its progress. `onEvent` receives
// each SSE event ({kind:'status'|'say'|'tool'|'approval'|'done'|'error', ...}).
// Resolves with the final { summary, branch, changed, sessionId, stopped }.
// `stopped` is true when the user interrupted it via cancelAgentTask().
export async function runAgentTask({ prompt, sessionId, onEvent }) {
  const { secret } = getAgentConfig();
  const url = await resolveAgentUrl();
  if (!url || !secret) throw new Error("Jarvis Build isn't connected yet — open Build and add the agent URL + secret.");

  const ctrl = new AbortController();
  activeTasks.add(ctrl);
  emitActivity();

  let result = { summary: '', branch: 'main', changed: false, sessionId: sessionId || null, stopped: false };
  try {
    const res = await fetch(`${url}/jarvis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ prompt, sessionId: sessionId || undefined }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      throw new Error(`Agent ${res.status}${t ? ` — ${t.slice(0, 200)}` : ''}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (ctrl.signal.aborted) break; // interrupted — fall through to stopped result
        throw e;
      }
      const { value, done } = chunk;
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop();
      for (const f of frames) {
        const line = f.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        onEvent?.(ev);
        if (ev.kind === 'done') {
          result = { ...result, summary: ev.text || '', branch: ev.branch || 'main', changed: !!ev.changed, sessionId: ev.sessionId || result.sessionId };
        }
      }
    }
    if (ctrl.signal.aborted) result.stopped = true;
    return result;
  } catch (e) {
    // An aborted fetch throws before we even get a reader — treat as a clean stop.
    if (ctrl.signal.aborted) { result.stopped = true; return result; }
    throw e;
  } finally {
    activeTasks.delete(ctrl);
    emitActivity();
  }
}

export async function approveAgentCommand({ id, password, deny }) {
  const { secret } = getAgentConfig();
  const url = await resolveAgentUrl();
  await fetch(`${url}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(deny ? { id, deny: true } : { id, password }),
  });
}

// One-tap "Make it live": ask the agent to merge a finished jarvis/* preview
// branch into main and push — Vercel then deploys it. Throws with the server's
// reason on failure (merge conflict, mid-build, etc.).
export async function deployBranch(branch) {
  const { secret } = getAgentConfig();
  const url = await resolveAgentUrl();
  if (!url || !secret) throw new Error('Jarvis Build is not connected.');
  const res = await fetch(`${url}/deploy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ branch }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Deploy failed (${res.status})`);
  return body;
}
