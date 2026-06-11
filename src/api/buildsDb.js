import { supabase } from './supabaseClient';

// Supabase-backed "Build" entity. Mirrors the localDb entity interface
// (filter/get/create/update/delete returning Promises) so existing
// base44.entities.Build callers work unchanged — but data now lives in Supabase
// and syncs across every signed-in device.

function mapRow(r) {
  if (!r) return r;
  // Alias Supabase timestamps to the legacy field names some pages expect.
  return { ...r, created_date: r.created_at, updated_date: r.updated_at };
}

function stripClient(data) {
  const row = { ...data };
  delete row.created_date;
  delete row.updated_date;
  return row;
}

export const buildsEntity = {
  async filter(query = {}, sort) {
    let q = supabase.from('builds').select('*');
    Object.entries(query).forEach(([k, v]) => { q = q.eq(k, v); });
    q = q.order('created_at', { ascending: sort && !String(sort).startsWith('-') ? true : false });
    const { data, error } = await q;
    if (error) return [];
    return (data || []).map(mapRow);
  },
  async list(sort) { return this.filter({}, sort); },
  async get(id) {
    const { data } = await supabase.from('builds').select('*').eq('id', id).maybeSingle();
    return mapRow(data);
  },
  async create(data) {
    const { data: created, error } = await supabase.from('builds').insert(stripClient(data)).select().single();
    if (error) throw error;
    return mapRow(created);
  },
  async update(id, data) {
    const { data: updated, error } = await supabase.from('builds').update(stripClient(data)).eq('id', id).select().single();
    if (error) throw error;
    return mapRow(updated);
  },
  async delete(id) {
    const { error } = await supabase.from('builds').delete().eq('id', id);
    if (error) throw error;
    return { id };
  },
};

// One-time, per-device migration: push this device's localStorage builds (and their
// phases) into Supabase so they appear everywhere. Deduped by name + van_model so
// running it on multiple devices doesn't create copies. Open the app once on each
// device that has builds you want kept.
export async function migrateLocalBuilds() {
  try {
    if (localStorage.getItem('builds_migrated_v1')) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return; // need to be signed in

    const raw = localStorage.getItem('localdb_Build');
    const local = raw ? JSON.parse(raw) : [];
    if (Array.isArray(local) && local.length) {
      const { data: existing } = await supabase.from('builds').select('name, van_model');
      const seen = new Set((existing || []).map(b => `${b.name}|${b.van_model || ''}`));
      for (const b of local) {
        const key = `${b.name}|${b.van_model || ''}`;
        if (seen.has(key)) continue;
        let phases = null;
        try {
          const p = localStorage.getItem(`buildPhases_${b.id}`);
          phases = p ? JSON.parse(p) : null;
        } catch { /* ignore */ }
        await supabase.from('builds').insert({
          name: b.name,
          van_model: b.van_model || null,
          company_id: b.company_id || 'vertexvans',
          status: b.status || null,
          sop_ids: b.sop_ids || null,
          phases,
        });
        seen.add(key);
      }
    }
    localStorage.setItem('builds_migrated_v1', '1');
  } catch { /* non-fatal — leave the flag unset to retry next load */ }
}
