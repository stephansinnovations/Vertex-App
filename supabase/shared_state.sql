-- Shared key/value blobs that sync across all devices and accounts (currently the
-- parts cart and the orders list). Run this once in the Supabase SQL editor.
create table if not exists public.shared_state (
  key text primary key,            -- 'cart' | 'orders'
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.shared_state enable row level security;

-- Internal tool: the anon/publishable key is already public, so allow anyone with
-- it to read + write the shared state.
drop policy if exists "shared_state all" on public.shared_state;
create policy "shared_state all" on public.shared_state for all using (true) with check (true);
