import { supabase } from './supabaseClient';

export async function getSetting(key) {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
  } catch {
    return localStorage.getItem(key);
  }
}

export async function setSetting(key, value) {
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
    localStorage.setItem(key, value);
  } catch {
    localStorage.setItem(key, value);
  }
}
