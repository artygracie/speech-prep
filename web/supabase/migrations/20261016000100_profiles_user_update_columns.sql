-- Users may update only their own non-billing profile fields.
--
-- profiles_update_own (RLS) scopes updates to the user's own row, but
-- the table-level grant let `authenticated` update every column. Any
-- signed-in user could therefore run, from the browser console with the
-- public anon key:
--   supabase.from('profiles').update({ plan: 'practiced' }).eq('id', me)
-- and unlock paid features. Billing columns (plan, subscription_status,
-- current_period_end, one_shot_speech_id, stripe_*), the credit counter
-- (sessions_used) and email-state columns are written only by the
-- server through the service-role client, which bypasses these grants.
--
-- Columns the app writes as the signed-in user:
--   attribution   /auth/callback, first-touch UTM capture
--   display_name, timezone   user-editable settings
--
-- This migration is safe to re-run.

REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, timezone, attribution) ON public.profiles TO authenticated;
