// Read every bug reported from the app's "Report Bug" button.
// Usage: node scripts/read-bugs.mjs
//
// Bugs live in the Supabase table public.bug_reports. Uses the same public
// URL + anon key the app ships with (src/api/supabaseClient.js).
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ufktfpwcobqxyjyiteot.supabase.co',
  'sb_publishable_g1VwJo9Tv07d35H4pUPDfg_yc3Ooxg4',
);

const { data, error } = await supabase
  .from('bug_reports')
  .select('*')
  .order('created_at', { ascending: false });

if (error) {
  console.error('Could not read bug_reports:', error.message);
  console.error('(Has supabase/bug_reports.sql been run yet?)');
  process.exit(1);
}

if (!data.length) {
  console.log('No bugs reported. 🎉');
  process.exit(0);
}

for (const b of data) {
  const where = b.path || b.url || '';
  console.log(`\n[${b.created_at}] (${b.source || '?'}) ${where}${b.resolved ? '  ✓ resolved' : ''}`);
  console.log(`  ${b.message}`);
  if (b.note) console.log(`  note: ${b.note}`);
  if (b.user_email) console.log(`  user: ${b.user_email}`);
}
console.log(`\nTotal: ${data.length} bug(s).`);
