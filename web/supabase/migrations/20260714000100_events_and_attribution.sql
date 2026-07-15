-- ============================================================================
-- First-party funnel events + acquisition attribution.
--
-- Part of the relaunch analytics workstream: the product previously had zero
-- funnel telemetry, so a ~400-signup traffic spike in June 2026 was
-- unexplainable. This adds:
--
--   1. public.events — an append-only first-party event log. Written ONLY by
--      the server (service role) via src/lib/track.ts and /api/t. Clients can
--      neither read nor write it: RLS is enabled with no policies, and grants
--      to anon/authenticated are revoked outright. The service role bypasses
--      RLS, so no policy is needed for it.
--
--   2. profiles.attribution — first-touch acquisition data (utm_*, gclid,
--      referrer, landing page) captured on the first landing into a 30-day
--      cookie and persisted here on the first authenticated request after
--      signup (profile rows themselves are created by the handle_new_user
--      trigger, so the cookie payload is attached post-hoc, only when null).
--
-- Event names are validated in the app layer against the allowlist in
-- src/lib/events.ts. Funnel queries live in docs/analytics.md.
-- ============================================================================

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  -- Null for anonymous (pre-auth) events; set null on account deletion so the
  -- funnel history survives.
  user_id uuid references public.profiles (id) on delete set null,
  -- Client-generated id for pre-auth events (demo flows, Wave 2).
  anon_id text,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.events is
  'First-party funnel events. Server-written only (service role via src/lib/track.ts); no client access.';

-- Funnel queries scan by event name over a date window…
create index if not exists events_name_created_at_idx
  on public.events (name, created_at);
-- …and join per-user journeys (signup → activation → purchase).
create index if not exists events_user_id_name_idx
  on public.events (user_id, name)
  where user_id is not null;

-- Server-only access: RLS on with no policies means anon/authenticated can do
-- nothing; the service role bypasses RLS. The revokes are belt-and-braces so
-- even a future accidentally-permissive policy can't expose the table through
-- PostgREST.
alter table public.events enable row level security;
revoke all on table public.events from anon, authenticated;

-- First-touch acquisition attribution, e.g.
-- {"utm_source":"google","utm_campaign":"...","gclid":"...",
--  "referrer":"https://…","landing_page":"/","first_seen_at":"…"}.
-- Written once (only while null) from the sp_attr cookie; see
-- src/lib/attribution.ts.
alter table public.profiles add column if not exists attribution jsonb;

comment on column public.profiles.attribution is
  'First-touch acquisition data (utm_*, gclid, referrer, landing page) captured from the sp_attr cookie at first authenticated request. Set once; never overwritten.';
