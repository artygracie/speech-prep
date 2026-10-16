-- One coach run per session at a time.
--
-- /api/coach/run is called by the transcribe edge function and by the
-- report page's AutoRefresh, usually within seconds of each other. Both
-- passed the "no ai_reports row yet" check, both paid for a Sonnet call,
-- and the second insert failed with a 500.
--
-- The route now claims the run first:
--   UPDATE sessions SET coach_claimed_at = now()
--   WHERE id = :id AND (coach_claimed_at IS NULL OR coach_claimed_at < now() - 90s)
-- and only calls the model when the claim wins. A claim older than 90s
-- is treated as abandoned (the route's maxDuration is 60s), so a crashed
-- run never blocks a retry. A failed run clears its claim.
--
-- This migration is safe to re-run.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS coach_claimed_at timestamptz NULL;

COMMENT ON COLUMN public.sessions.coach_claimed_at IS
  'When a /api/coach/run call claimed this session''s coach run. Claims older than 90s are stale. Cleared when a run fails.';
