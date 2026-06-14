-- Bug reports filed from the app's "Report Bug" button (see src/api/bugReports.js).
-- Run this once in the Supabase SQL editor. Note: the whole script runs as one
-- transaction, so statement order matters.

create table if not exists public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  message     text,
  stack       text,
  source      text,          -- 'render' | 'window' | 'promise' | 'manual'
  url         text,
  path        text,
  user_agent  text,
  user_email  text,
  note        text,
  resolved    boolean not null default false
);

alter table public.bug_reports enable row level security;

-- This is an internal tool and the anon key is already public, so let anyone file
-- a bug and read the list back. Tighten with is_admin() later if needed.
drop policy if exists "bug_reports insert" on public.bug_reports;
create policy "bug_reports insert" on public.bug_reports
  for insert with check (true);

drop policy if exists "bug_reports select" on public.bug_reports;
create policy "bug_reports select" on public.bug_reports
  for select using (true);
