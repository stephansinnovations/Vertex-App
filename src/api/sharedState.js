// Cross-device/account sync for small JSON blobs (the cart and orders). Stored in
// the Supabase `shared_state` table; localStorage stays the fast in-tab cache.
// Run supabase/shared_state.sql once to create the table.
import { supabase } from '@/api/supabaseClient';

export async function loadShared(key) {
  const { data, error } = await supabase.from('shared_state').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function saveShared(key, value) {
  const { error } = await supabase
    .from('shared_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
