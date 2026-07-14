-- Add speeches.event_date — the calendar date of the real-world event
-- the speech is for (wedding, retirement dinner, memorial, …).
--
-- Nullable by design: every creation flow asks "When's the speech?" as
-- an optional, one-click-skippable question. A null simply means the
-- user hasn't told us yet.
--
-- Consumers:
--   - lifecycle engine (web/src/lib/lifecycle.ts) — daysUntilEvent
--     drives the phase arc and nextNudge()
--   - countdown chips on the speech detail header and dashboard cards
--   - Wave-2 practice-reminder emails
--
-- No RLS changes needed: speeches row policies already scope by user_id
-- and cover the new column.

alter table public.speeches
  add column if not exists event_date date;

comment on column public.speeches.event_date is
  'Date of the real-world event this speech is for. Null = not provided (the question is optional in every creation flow).';
