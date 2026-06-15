// Part-add queue (Supabase `part_queue`). The Chrome extension inserts product
// URLs; the Parts Library reads pending rows and processes them (AI fill + write
// to the sheet). Run supabase/part_queue.sql once to create the table.
import { supabase } from '@/api/supabaseClient';

export async function addToQueue(url) {
  const { error } = await supabase.from('part_queue').insert({ url });
  if (error) throw error;
}

// Oldest first, so the queue processes in the order things were added.
export async function getQueue() {
  const { data, error } = await supabase
    .from('part_queue')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateQueueItem(id, patch) {
  const { error } = await supabase.from('part_queue').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteQueueItem(id) {
  const { error } = await supabase.from('part_queue').delete().eq('id', id);
  if (error) throw error;
}

// Remove finished rows (done + error) so the list stays clean.
export async function clearFinishedQueue() {
  const { error } = await supabase.from('part_queue').delete().in('status', ['done', 'error']);
  if (error) throw error;
}
