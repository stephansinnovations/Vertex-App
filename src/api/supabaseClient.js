import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ufktfpwcobqxyjyiteot.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_g1VwJo9Tv07d35H4pUPDfg_yc3Ooxg4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
