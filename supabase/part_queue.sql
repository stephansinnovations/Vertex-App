-- Queue of product URLs to add to the parts library. The Chrome extension
-- inserts rows; the Parts Library page processes pending rows (AI fill + write to
-- the sheet) when you press Start. Run this once in the Supabase SQL editor.
create table if not exists public.part_queue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  url text not null,
  status text not null default 'pending', -- pending | processing | done | error
  part_name text,
  category text,
  subcategory text,
  error text,
  done_at timestamptz
);

alter table public.part_queue enable row level security;

-- Internal tool: the anon/publishable key is already public, so allow anyone with
-- it to queue, read, update and clear rows.
drop policy if exists "part_queue all" on public.part_queue;
create policy "part_queue all" on public.part_queue for all using (true) with check (true);
