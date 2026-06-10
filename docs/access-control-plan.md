# Accounts, Roles & Access Control — Design Plan

Status: **DESIGN — not yet implemented.** Implementation is staged (see Rollout).

## 1. Goal

Support multiple user accounts with an **admin** role, a shared **team directory**,
and **server-enforced** access rules:

- `stephansinnovations@gmail.com` is **admin**. Everyone else is **member**.
- **Team Profiles** lists every account with its role label (Admin / Member). All
  signed-in users can view it.
- **Non-admins cannot** open **Settings**, **Vertex**, or **AI Rooms**.
- **Non-admins can only delete the parts / SOPs / builds they added.**
- Admins can do everything.

## 2. Current state (why this needs a backend)

| Data | Where it lives today | Shared? | Owner tracked? |
|---|---|---|---|
| Login / accounts | Supabase Auth | yes | n/a |
| SOPs, WorkOrders, Builds, MeetingNotes, SOPPerformance, StockItems, **Users** | **`localStorage` per device** (`src/api/localDb.js`) | **no** | **no** |
| `app_settings`, `chat_history`, `ai_rooms`, `ai_agents`, `builds` | Supabase | yes | no |
| Parts | **Google Sheet** (one shared OAuth identity) | yes (shared) | no |

Two hard blockers for the rules as written:
1. **No shared user directory** — you can't list Supabase Auth users from the browser,
   and the current "User list" is per-device localStorage. → need a `profiles` table.
2. **No ownership, and most data isn't even shared** — "delete only what you added" is
   meaningless while SOPs/builds live in per-device localStorage. → migrate to Supabase
   with an `owner` column + Row Level Security (RLS).

Also note: **`builds` is duplicated** (localStorage `Build` entity *and* a Supabase
`builds` table). This must be consolidated onto Supabase.

> **Security principle:** client-side route guards are **UX only** — a determined user can
> bypass them. Real enforcement = **Supabase RLS** on the underlying tables. This plan uses
> RLS as the source of truth and client guards only for UX.

## 3. Target data model (Supabase)

```sql
-- 3.1 Profiles + roles -------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  job_title text,
  phone text,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz default now()
);

-- auto-create a profile row on signup
create function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''),
    case when new.email = 'stephansinnovations@gmail.com' then 'admin' else 'member' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- backfill any existing users
insert into public.profiles (id, email, role)
select id, email,
       case when email='stephansinnovations@gmail.com' then 'admin' else 'member' end
from auth.users
on conflict (id) do nothing;

-- helper used by every policy below
create function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin');
$$;

-- 3.2 Profiles RLS -----------------------------------------------------------
alter table public.profiles enable row level security;
create policy "read all profiles"   on public.profiles for select to authenticated using (true);
create policy "update own profile"   on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid())); -- can't self-promote
create policy "admin manages roles"  on public.profiles for update to authenticated
  using (public.is_admin());
```

### 3.3 Owned content tables (SOPs, builds, work orders, …)

Each migrated table gets `owner uuid not null default auth.uid()` and the same RLS
shape. Example for `sops` (repeat for `builds`, `work_orders`, `meeting_notes`,
`sop_performance`, `stock_items`):

```sql
create table public.sops (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id),
  -- existing fields: title, "group", description, steps jsonb, company_id, ...
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.sops enable row level security;

create policy "read sops"   on public.sops for select to authenticated using (true);
create policy "insert sops"  on public.sops for insert to authenticated with check (owner = auth.uid());
create policy "update sops"  on public.sops for update to authenticated
  using (owner = auth.uid() or public.is_admin());
create policy "delete sops"  on public.sops for delete to authenticated
  using (owner = auth.uid() or public.is_admin());  -- ← "delete only what you added"
```

The **delete policy is the real enforcement** of "non-admins can only delete what they
added." The client just hides the delete button when `owner !== me && !isAdmin` for UX.

### 3.4 Settings & AI Rooms (admin-only features)

```sql
-- AI Rooms / agents: admin-only (non-admins can't use them at all)
alter table public.ai_rooms  enable row level security;
alter table public.ai_agents enable row level security;
create policy "admin rooms"  on public.ai_rooms  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin agents" on public.ai_agents for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

**Settings wrinkle (needs a decision):** `app_settings` holds the Master Sheet URL **and
the Gemini/Anthropic API keys**. Non-admins still need *some* of these to use Parts
features (e.g. the Gemini key for "AI fill"/photo). So we can't make `app_settings`
fully admin-only. Plan: **split it** —
- `read` allowed to all authenticated (so members can use the master sheet + AI fill), but
- `insert/update/delete` allowed **only to admins** (so only admins edit settings), and
- the **Settings *page*** is admin-only on the client.
- (Optional hardening: move the secret API keys to a separate `secrets` table that only a
  server function can read, so members never receive raw keys. Larger change — Phase 5.)

## 4. Parts ownership (the awkward one)

Parts live in a **shared Google Sheet** written via **one shared OAuth identity**. There
is no per-user identity at the sheet level, and any user can edit the sheet directly.
Options:

- **A. `added_by` column in the sheet (UX-level).** When a part is added through the app,
  write the user's email into a hidden column. The in-app delete button checks
  `added_by === myEmail || isAdmin`. *Cannot* stop someone editing the sheet directly —
  UX gate only.
- **B. Mirror ownership in Supabase** (`part_ownership` table keyed by sheet+row).
  Same UX-level limitation; the sheet is still the shared source of truth.
- **C. Move parts off Google Sheets into a Supabase `parts` table** with `owner` + RLS.
  Real enforcement, but loses the "live master sheet" you rely on today. Big change.

**Recommendation:** ship **A** now (honest UX gate + a note that the sheet itself is shared),
and treat **C** as a separate future decision if true enforcement on parts is required.

## 5. Rule → enforcement map

| Rule | Real enforcement | Client UX |
|---|---|---|
| Your email = admin | `profiles.role`, trigger + backfill | `useAuth().isAdmin` |
| Team Profiles shows all + labels | read `profiles` (RLS: all authenticated) | rebuild TeamProfiles to read `profiles` |
| Non-admin can't open Settings | `app_settings` writes admin-only + (Phase 5) secrets server-side | redirect from `/Settings` |
| Non-admin can't open Vertex / AI Rooms | `ai_rooms`/`ai_agents` RLS admin-only | redirect from `/Vertex`, `/AIRoom`, `/Rooms` |
| Delete only own SOPs | `sops` delete policy | hide delete unless owner/admin |
| Delete only own builds | `builds` delete policy | hide delete unless owner/admin |
| Delete only own parts | (Option A) sheet `added_by`, UX only | hide delete unless added_by/admin |

## 6. Migrating existing localStorage data

Existing SOPs/builds/etc. are scattered in each device's localStorage. One-time migration:
a small in-app "Import my local data" action (admin only) that reads `localdb_*` and inserts
into the new Supabase tables with `owner = current user`. Records on other devices are
separate and would need the same action there. (In practice today the data is mostly on the
admin's device, so this is low-risk.)

## 7. Client changes

- `AuthContext`: after session loads, fetch the user's `profiles` row → expose
  `profile`, `role`, `isAdmin`.
- New `AdminRoute` wrapper (like `ProtectedRoute`) → redirect non-admins to Home.
  Wrap `/Settings`, `/Vertex`, `/AIRoom`, `/Rooms`.
- Repoint `base44.entities.{SOP,Build,WorkOrder,...}` from `localDb` to thin Supabase-backed
  clients (same `filter/get/create/update/delete` shape) so page code barely changes.
- `TeamProfiles`: read `profiles`; show role label (Admin / Member).
- Delete buttons (SOP, Build, Part): show only when `owner === me || isAdmin`.

## 8. Staged rollout

- **Phase 1 — Identity & gating (no data migration).** `profiles` + trigger + `is_admin()`;
  `AuthContext.isAdmin`; `AdminRoute` on Settings/Vertex/Rooms; `ai_rooms`/`ai_agents` +
  `app_settings`-write RLS; rebuild Team Profiles from `profiles`. *Delivers: admin, team
  directory, and Settings/Rooms lockout — all server-enforced.*
- **Phase 2 — SOPs to Supabase.** `sops` table + RLS + owner; Supabase-backed SOP entity;
  one-time import; owner-gated delete.
- **Phase 3 — Builds to Supabase (consolidate the duplicate).** `builds` owner + RLS;
  Supabase-backed Build/WorkOrder entities; import; owner-gated delete.
- **Phase 4 — Remaining entities** (MeetingNotes, SOPPerformance, StockItems) for parity.
- **Phase 5 — Parts ownership** (Option A `added_by` UX gate) and optional secrets hardening.

Each phase ships independently and is verifiable.

## 8a. Decisions (locked 2026-06-09)

1. **Parts:** Option A — UX-level `added_by` gate; keep the Google Sheet.
2. **API keys:** members may **read** the shared keys; only admins **edit** settings.
3. **Local data:** non-admins **do** have important local data → migration must be careful
   and **per-device** (run on each user's device; only migrate user-created records, never
   the seed SOPs/WorkOrders, to avoid cross-device duplication).
4. **Members:** may **create/edit their own** SOPs/builds (and delete only their own).

## 9. Open decisions (resolved — see §8a)

1. **Parts enforcement:** OK with **Option A** (UX-level `added_by`, since the sheet is
   shared) for now, or do you want parts fully moved into Supabase (Option C)?
2. **API keys:** OK for members to *read* the shared Gemini/Anthropic keys (so their AI
   features work), with only admins able to *edit* settings? Or should keys be fully hidden
   from members (Phase 5 server-side secrets)?
3. **Local data:** anything important currently in SOPs/builds on a non-admin device, or is
   it all on your (admin) device? Determines how careful the migration must be.
4. **Members' capabilities:** beyond the deletes, can members *create/edit* SOPs/builds, or
   only view + manage their own? (Policies above let them create and edit their own.)
