-- Event Pass relaunch (2026-07-14): free tier drops from 3 lifetime
-- sessions to ONE full rehearsal (with the complete coach report).
--
-- Redefines the `entitlements` view with the free allowance = 1. The
-- definition below is the live view (fetched via
-- `pg_get_viewdef('entitlements'::regclass, true)` on 2026-07-14) with
-- only the two free-allowance literals changed: `sessions_used < 3` →
-- `< 1`, and `GREATEST(0, 3 - sessions_used)` → `GREATEST(0, 1 - ...)`.
--
-- Everything reading the view (paywall in createSession, billing page,
-- top-bar pill, upgrade cards) picks the new cap up automatically —
-- the app-side constant lives in web/src/lib/plan-limits.ts
-- (FREE_SESSION_LIMIT) and must stay in lockstep with this view.
--
-- Note: existing free users with sessions_used >= 1 become unentitled
-- the moment this applies. That is the intended relaunch behavior —
-- they have already received a full free report.
--
-- This migration is safe to re-run.

CREATE OR REPLACE VIEW public.entitlements AS
SELECT id AS user_id,
    plan,
    subscription_status,
    current_period_end,
    one_shot_speech_id,
    sessions_used,
    CASE
        WHEN plan = 'practiced'::text AND (subscription_status = ANY (ARRAY['active'::text, 'trialing'::text])) AND (current_period_end IS NULL OR current_period_end > now()) THEN true
        WHEN plan = 'single_speech'::text AND current_period_end IS NOT NULL AND current_period_end > now() THEN true
        WHEN plan = 'free'::text AND sessions_used < 1 THEN true
        ELSE false
    END AS is_entitled,
    CASE
        WHEN plan = 'free'::text THEN GREATEST(0, 1 - sessions_used)
        ELSE NULL::integer
    END AS free_sessions_remaining
FROM profiles p;

COMMENT ON VIEW public.entitlements IS
  'Per-user entitlement derived from profiles. Free allowance is ONE full rehearsal (2026-07-14 Event Pass relaunch); paid plans gate on Stripe subscription/pass state.';
