// App-wide bug reporting. Errors anywhere in the app surface a "Report Bug" button
// (see ErrorBoundary + GlobalErrorReporter); clicking it persists the bug here.
//
// Bugs are stored in the Supabase table `public.bug_reports` (cross-device, and
// readable later — e.g. `node scripts/read-bugs.mjs`). A localStorage copy
// (`vertex_bug_reports`) is always kept too, so nothing is lost if the user is
// offline or the table hasn't been created yet. Run supabase/bug_reports.sql once
// to create the table + policies.
import { supabase } from '@/api/supabaseClient';

const LS_KEY = 'vertex_bug_reports';

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}
function writeLocal(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 200))); } catch { /* quota */ }
}

// Build a bug record from an error (or message string) + the current page context.
export function buildBug(error, source = 'manual', extra = {}) {
  const e = error || {};
  const message = typeof e === 'string' ? e : (e.message || String(e) || 'Unknown error');
  return {
    message: String(message).slice(0, 1000),
    stack: String(e.stack || '').slice(0, 4000),
    source, // 'render' | 'window' | 'promise' | 'manual'
    url: typeof window !== 'undefined' ? window.location.href : '',
    path: typeof window !== 'undefined' ? window.location.pathname : '',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    created_at: new Date().toISOString(),
    ...extra,
  };
}

// Persist a bug. Always keeps a local copy first (never lose one), then tries to
// sync it to Supabase so it can be read back later.
export async function reportBug(bug) {
  const record = { ...bug };

  const local = readLocal();
  local.unshift({ ...record, id: `local_${Date.now()}` });
  writeLocal(local);

  try {
    let email = record.user_email || '';
    if (!email) {
      try { email = (await supabase.auth.getUser()).data?.user?.email || ''; } catch { /* not signed in */ }
    }
    const { error } = await supabase.from('bug_reports').insert({
      message: record.message,
      stack: record.stack,
      source: record.source,
      url: record.url,
      path: record.path,
      user_agent: record.user_agent,
      user_email: email,
      note: record.note || '',
    });
    if (error) throw error;
    return { ok: true, synced: true };
  } catch (err) {
    // Kept locally — still "reported" from the user's perspective.
    return { ok: true, synced: false, error: err?.message || 'saved locally only' };
  }
}

// Read every reported bug (newest first). Falls back to the local copy if Supabase
// is unreachable or the table doesn't exist yet.
export async function getBugReports() {
  try {
    const { data, error } = await supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch {
    return readLocal();
  }
}

// Local-only rows (offline / no table yet) carry a `local_…` id; everything else
// is a Supabase uuid. Mutations route to the right store by that prefix.
function isLocalId(id) { return typeof id === 'string' && id.startsWith('local_'); }

function updateLocal(id, patch) {
  const list = readLocal().map(b => (b.id === id ? { ...b, ...patch } : b));
  writeLocal(list);
}

export async function setBugResolved(id, resolved) {
  if (isLocalId(id)) { updateLocal(id, { resolved }); return { ok: true }; }
  const { error } = await supabase.from('bug_reports').update({ resolved }).eq('id', id);
  return { ok: !error, error: error?.message };
}

export async function deleteBug(id) {
  if (isLocalId(id)) { writeLocal(readLocal().filter(b => b.id !== id)); return { ok: true }; }
  const { error } = await supabase.from('bug_reports').delete().eq('id', id);
  return { ok: !error, error: error?.message };
}
