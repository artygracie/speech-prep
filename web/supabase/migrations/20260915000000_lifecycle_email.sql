-- Lifecycle email (ART-809).
--
-- SpeechPrep sends no email today. Memorization is a multi-day project
-- (docs/memorization-research.md) and only 5 users have ever rehearsed on
-- two different days, so nothing currently brings anyone back for day two.
--
-- The decision of *what* to send and *when* already exists and is pure:
-- `nextNudge()` in web/src/lib/lifecycle.ts. This migration adds only the
-- state that decision needs to be delivered safely and once.
--
-- Design notes, learned from the PlanSeats drip (which is dead code, and
-- instructive about why):
--   * The dedupe key is (speech_id, subject_key, scheduled_for) rather than
--     a monotonic email number. A state machine can legitimately revisit a
--     phase, so "email #4 already sent" is the wrong question; "did we
--     already send this nudge for this speech today" is the right one.
--   * Suppression lives in the queue view's WHERE clause, not only in
--     application code. PlanSeats' drip checked neither unsubscribes nor
--     bounces because its view didn't expose them.
--   * A failed send must NOT leave a lock row behind. PlanSeats' insert-lock
--     pattern permanently suppressed any email whose Resend call failed
--     transiently. Here the row carries a status and failures are deleted
--     so the next sweep retries.

-- ---------------------------------------------------------------------------
-- profiles: delivery preferences and local time
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- Set on explicit unsubscribe or a Resend spam complaint. Suppresses ALL
  -- non-transactional mail while set, and is never auto-cleared.
  add column if not exists email_unsubscribed_at timestamptz,
  -- Set on a hard bounce. Unlike a complaint this CAN clear, on the next
  -- successful delivery.
  add column if not exists email_bounced_at timestamptz,
  -- Capability URL for one-click unsubscribe. Unguessable and revocable by
  -- regenerating, which is why this is a token column rather than the user
  -- id in a signed URL.
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid(),
  -- IANA zone captured from the browser. nextNudge() schedules at 19:00
  -- local; without this we would send everyone at one server hour and the
  -- "practice a few hours before sleep" rationale would be noise.
  add column if not exists timezone text;

comment on column public.profiles.email_unsubscribed_at is
  'Explicit unsubscribe or spam complaint. Suppress all non-transactional mail while set. Never auto-cleared.';
comment on column public.profiles.timezone is
  'IANA timezone from the browser (Intl.DateTimeFormat().resolvedOptions().timeZone). Null means fall back to the app default.';

create unique index if not exists profiles_unsubscribe_token_idx
  on public.profiles (unsubscribe_token);

-- ---------------------------------------------------------------------------
-- email_sends: the ledger, and the lock
-- ---------------------------------------------------------------------------

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Null for account-level mail (the welcome) that isn't about one speech.
  speech_id uuid references public.speeches (id) on delete cascade,
  -- One of the keys nextNudge() returns, or 'welcome'.
  subject_key text not null,
  -- The local calendar day the send was scheduled for. Part of the dedupe
  -- key so a user gets at most one of a given nudge per day.
  scheduled_for date not null,
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'failed')),
  resend_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- The lock. Insert before sending; a 23505 means someone already has it.
create unique index if not exists email_sends_dedupe_idx
  on public.email_sends (user_id, coalesce(speech_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_key, scheduled_for);

create index if not exists email_sends_user_created_idx
  on public.email_sends (user_id, created_at desc);

comment on table public.email_sends is
  'Lifecycle email ledger. Written by the cron sweep via the service role only. A row is inserted as a lock BEFORE the send; failures are deleted so the next sweep retries.';

-- Server-written only, exactly like public.events.
alter table public.email_sends enable row level security;
revoke all on public.email_sends from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
--
-- Cheap pre-filter. gatherSpeechSignals() costs ~6 queries plus an alignment
-- pass per speech, so the sweep must never call it for a user who obviously
-- isn't due. Everything here is index-friendly; the expensive per-speech
-- work happens in the app for whatever survives this.

create or replace view public.pending_speech_nudges
with (security_invoker = true) as
select
  s.id            as speech_id,
  s.user_id,
  s.title,
  s.occasion,
  s.event_date,
  s.current_version,
  p.email,
  p.display_name,
  p.timezone,
  p.unsubscribe_token,
  (select max(created_at) from public.sessions where speech_id = s.id) as last_session_at
from public.speeches s
join public.profiles p on p.id = s.user_id
where
  -- Deliverable
  p.email is not null
  and p.email_unsubscribed_at is null
  and p.email_bounced_at is null
  -- The event hasn't passed.
  and (s.event_date is null or s.event_date >= current_date)
  -- Recency guard. Without this, every speech ever abandoned stays
  -- eligible forever: on 2026-09-15 that was 133 rows versus 2 genuinely
  -- live ones, so switching the cron on would have mailed months-dormant
  -- users about speeches they walked away from. A speech is live if the
  -- event is still coming, it was made recently, or it has been rehearsed
  -- recently.
  and (
    s.event_date >= current_date
    or s.created_at >= now() - interval '30 days'
    or exists (
      select 1 from public.sessions ss
      where ss.speech_id = s.id and ss.created_at >= now() - interval '14 days'
    )
  )
  -- Nothing already queued or sent for this speech today, whatever the key.
  and not exists (
    select 1 from public.email_sends e
    where e.speech_id = s.id
      and e.scheduled_for = current_date
      and e.status in ('sending', 'sent')
  );

comment on view public.pending_speech_nudges is
  'Cheap pre-filter for the lifecycle cron. Suppression (unsubscribe, bounce) is enforced here rather than only in app code, so a caller cannot forget it.';

revoke all on public.pending_speech_nudges from anon, authenticated;
