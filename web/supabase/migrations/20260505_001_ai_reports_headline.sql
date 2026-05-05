-- Coaching v2, Sprint 1: add the hero "headline" pull-quote field to ai_reports.
--
-- The coach prompt now returns a structured `headline` (≤90 chars,
-- one-sentence pull-quote) in addition to the prose `summary`. This is
-- rendered as a large serif quote at the top of the coach card.
--
-- Backfill: NULL is fine. The UI falls back to the first sentence of
-- `summary` when `headline` is null, so old reports keep rendering.
--
-- This migration is safe to re-run.

ALTER TABLE public.ai_reports
  ADD COLUMN IF NOT EXISTS headline TEXT;

COMMENT ON COLUMN public.ai_reports.headline IS
  'Hero pull-quote (≤90 chars) — the single most important takeaway. Coach v2+. Falls back to first sentence of summary when null.';
