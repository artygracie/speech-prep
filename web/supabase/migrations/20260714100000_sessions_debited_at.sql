-- Debit-on-success: free-tier session credits used to be burned at
-- upload time (finalizeSession bumped profiles.sessions_used the
-- moment audio landed), so a failed transcription or coach run still
-- consumed a credit. The debit now happens on the report-delivery
-- success path (/api/coach/run, after the ai_reports insert).
--
-- sessions.debited_at records when (and whether) a session consumed a
-- credit. The debit path claims it with
--   UPDATE sessions SET debited_at = now()
--   WHERE id = :id AND debited_at IS NULL
-- and only increments profiles.sessions_used when the claim wins, so
-- coach retries and wake re-fires can never double-charge.
--
-- Backfill: intentionally none. Historical sessions were already
-- debited under the old at-upload rule; NULL here simply means "this
-- session has not consumed a credit via the new path".
--
-- This migration is safe to re-run.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS debited_at timestamptz NULL;

COMMENT ON COLUMN public.sessions.debited_at IS
  'When this session consumed a free-tier credit (profiles.sessions_used). NULL = not debited. Set by /api/coach/run on report delivery; idempotent via UPDATE ... WHERE debited_at IS NULL.';
