# SpeechPrep analytics — funnel, attribution, and Google Ads conversions

How the relaunch funnel is measured, where the events come from, and the SQL
that answers "is this working?" every week. Context: the June 2026 traffic
push produced ~400 signups that were unexplainable because the product had no
funnel events and no attribution capture. This closes both gaps before Google
Ads is relit.

- Strategy: https://artyfacts.ai/a/a6c4baa0-a4eb-4d58-8af1-aa246edfa894
- Implementation plan: https://artyfacts.ai/a/43a439f5-bbbf-40e2-8d58-6ce5fca9fa5b

---

## 1. The event model

First-party events land in `public.events` (migration
`20260714000100_events_and_attribution.sql`). The table is **server-write
only**: RLS is enabled with zero policies and grants are revoked, so the only
writers are the service-role helpers in `web/src/lib/track.ts` and the beacon
route `POST /api/t`. Event names are allowlisted in `web/src/lib/events.ts`.

| Event | Fires when | Fired from |
| --- | --- | --- |
| `signup` | First login within 30 min of account creation | `web/src/app/auth/callback/route.ts` |
| `speech_created` | Speech created; props `{source: paste\|upload\|writer, occasion}` | `web/src/app/app/actions.ts` (all three create paths) |
| `session_started` | User hits Record | WS-A integration (below) |
| `session_uploaded` | Recording finalized + uploaded | WS-A integration (below) |
| `report_delivered` | `ai_reports` row written | WS-A integration (below) |
| `report_viewed` | Finished report rendered for the user | `web/src/app/app/(shell)/speeches/[id]/sessions/[sid]/page.tsx` |
| `checkout_opened` | Stripe checkout session created | WS-B integration (below) |
| `purchase_completed` | Verified purchase on the billing success page | `web/src/app/app/(shell)/billing/success/page.tsx` |
| `demo_started`, `demo_report`, `demo_signup`, `oauth_signup` | Reserved for Wave 2 (public demo + OAuth) | — |

### Pipeline integration — WS-A (one line per call site)

1. **session_started** — `web/src/app/app/sessions-actions.ts`, in
   `createSession()`, immediately before `return { ok: true, … }`:
   `await trackSessionStarted(user.id, { speech_id: speechId, session_id: session.id, mode });`
2. **session_uploaded** — same file, in `finalizeSession()`, right after the
   status→`uploaded` update succeeds (`if (upErr) throw upErr;`):
   `await trackSessionUploaded(user.id, { speech_id: existing.speech_id, session_id: args.sessionId, duration_ms: args.durationMs });`
3. **report_delivered** — `web/src/app/api/coach/run/route.ts`, right after
   the `ai_reports` insert succeeds (the `if (insErr)` guard at ~line 197):
   `await trackReportDelivered(session.user_id, { session_id: sessionId, speech_id: session.speech_id });`
4. All three helpers are exported from `@/lib/track` and never throw.
5. If the coach ever moves into the Supabase edge function, insert into
   `events` there directly with the service client instead.

### Billing integration — WS-B

**checkout_opened** — `web/src/app/app/billing-actions.ts`, after each
`stripe.checkout.sessions.create(...)` returns a URL (both the subscription
and single-speech paths):
`await trackCheckoutOpened(user.id, { plan: "practiced" /* or "single_speech" */, speech_id });`

---

## 2. Attribution

- First touch (utm_source / medium / campaign / term / content, `gclid`,
  external referrer, landing path, timestamp) is captured by a
  dependency-free inline snippet in the root layout into a 30-day `sp_attr`
  cookie (`web/src/lib/attribution.ts`). First touch wins — the cookie is
  never overwritten.
- On the first authenticated request (the auth callback — profile rows are
  created by the `handle_new_user` DB trigger), the cookie is persisted to
  `profiles.attribution` **only while that column is null**.

Where did last month's signups come from:

```sql
select
  coalesce(
    attribution->>'utm_source',
    case when attribution ? 'gclid' then 'google-ads (gclid)' end,
    attribution->>'referrer',
    'direct/unknown'
  ) as source,
  count(*) as signups
from profiles
where created_at >= now() - interval '30 days'
group by 1
order by 2 desc;
```

Note: `attribution` is null for everyone who signed up before this shipped
(including the June cohort — that data is gone; this exists so it never
happens again).

---

## 3. The weekly funnel dashboard

Paste into the Supabase SQL editor. Cohorts are signup weeks; the first four
stages read the domain tables so they work **retroactively** (including the
June cohort); checkout/purchase read `events` and only populate going
forward.

```sql
-- Weekly funnel: signup → speech → first session → report → D2+ return
--                → checkout opened → purchase
with cohort as (
  select id as user_id,
         date_trunc('week', created_at)::date as signup_week,
         created_at as signed_up_at
  from profiles
  where created_at >= now() - interval '12 weeks'
),
first_speech as (
  select user_id, min(created_at) as at from speeches group by 1
),
first_session as (
  select user_id, min(created_at) as at from sessions group by 1
),
first_report as (
  select user_id, min(created_at) as at from ai_reports group by 1
),
d2_return as (
  -- Active on a later calendar day than signup, within 14 days.
  select distinct c.user_id
  from cohort c
  join sessions s on s.user_id = c.user_id
  where s.created_at::date > c.signed_up_at::date
    and s.created_at < c.signed_up_at + interval '14 days'
),
checkout as (
  select distinct user_id from events where name = 'checkout_opened'
),
purchase as (
  select distinct user_id from events where name = 'purchase_completed'
)
select
  c.signup_week,
  count(*)                                                        as signups,
  count(fspeech.user_id)                                          as created_speech,
  count(fsession.user_id)                                         as first_session,
  count(freport.user_id)                                          as report_delivered,
  count(d2.user_id)                                               as d2_return,
  count(ck.user_id)                                               as checkout_opened,
  count(p.user_id)                                                as purchased,
  round(100.0 * count(freport.user_id) / nullif(count(*), 0), 1)  as signup_to_report_pct,
  round(100.0 * count(d2.user_id)      / nullif(count(*), 0), 1)  as d2_return_pct,
  round(100.0 * count(p.user_id) / nullif(count(freport.user_id), 0), 1)
                                                                  as activated_to_purchase_pct
from cohort c
left join first_speech  fspeech  on fspeech.user_id  = c.user_id
left join first_session fsession on fsession.user_id = c.user_id
left join first_report  freport  on freport.user_id  = c.user_id
left join d2_return     d2       on d2.user_id       = c.user_id
left join checkout      ck       on ck.user_id       = c.user_id
left join purchase      p        on p.user_id        = c.user_id
group by 1
order by 1 desc;
```

Retroactive purchase check (before `purchase_completed` has history):

```sql
select date_trunc('week', created_at)::date as signup_week,
       count(*) filter (where plan <> 'free') as paid_profiles,
       count(*) as signups
from profiles
group by 1 order by 1 desc;
```

### Target bars

| Metric | Target |
| --- | --- |
| signup → report delivered | **40%+** |
| D2+ return (event-dated users) | **25%+** |
| activated (report delivered) → purchase | **5–10%** |
| demo → signup (Wave 2) | **25%+** |

Demo funnel (meaningful once Wave 2 ships the public demo):

```sql
select
  count(distinct anon_id) filter (where name = 'demo_started') as demo_started,
  count(distinct anon_id) filter (where name = 'demo_report')  as demo_report,
  count(distinct anon_id) filter (where name = 'demo_signup')  as demo_signup,
  round(100.0 * count(distinct anon_id) filter (where name = 'demo_signup')
      / nullif(count(distinct anon_id) filter (where name = 'demo_started'), 0), 1)
    as demo_to_signup_pct
from events
where name like 'demo_%'
  and created_at >= now() - interval '4 weeks';
```

---

## 4. Health checks

**No-audio report rate** — coach reports that claim silence over a transcript
that plainly has words. Should be **0** after WS-A's pipeline fix; anything
else means the coach is being fed the wrong audio/transcript.

```sql
select
  date_trunc('week', r.created_at)::date as week,
  count(*) as reports,
  count(*) filter (
    where length(btrim(t.text)) > 0
      and r.summary ilike any (array[
        '%no audio%', '%didn''t hear%', '%couldn''t hear%',
        '%could not hear%', '%silence%', '%silent%', '%blank recording%',
        '%no speech%', '%nothing was said%'
      ])
  ) as suspected_no_audio_reports
from ai_reports r
join transcripts t on t.session_id = r.session_id
group by 1
order by 1 desc;
```

(Heuristic on the summary text — eyeball any hits before declaring a
regression.)

**Sessions debited vs failed** — free-tier credits are debited at upload
(`finalizeSession` bumps `profiles.sessions_used`). Failed/stuck sessions
that were debited but never produced a report are users paying for nothing.

```sql
-- Weekly status mix
select
  date_trunc('week', created_at)::date as week,
  count(*)                                          as sessions,
  count(*) filter (where status = 'transcribed')    as transcribed,
  count(*) filter (where status = 'uploaded')       as stuck_uploaded,
  count(*) filter (where status = 'failed')         as failed,
  count(*) filter (where status = 'recording')      as still_recording,
  round(100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0), 1)
                                                    as failed_pct
from sessions
group by 1
order by 1 desc;

-- Debited-but-no-report drift (all time; should trend to 0)
select
  count(*) filter (where s.status in ('uploaded', 'transcribed')) as debited_sessions,
  count(r.id)                                                     as reports_delivered,
  count(*) filter (where s.status in ('uploaded', 'transcribed')) - count(r.id)
                                                                  as debited_without_report
from sessions s
left join ai_reports r on r.session_id = s.id;
```

---

## 5. Google Ads conversion setup (founder steps)

The site already loads the Google tag (`AW-18139578575`) from
`web/src/app/layout.tsx`. The code fires two conversions, each gated on an
env var and a clean no-op until it's set — safe to deploy first, configure
later, **but both must be configured before relighting ads**.

1. Google Ads → **Goals → Conversions → Summary → + New conversion action →
   Website** → enter `speechprep.ai` → choose **"Add a conversion action
   manually"** (the tag is already installed; don't let it re-scan).
2. Create **"SpeechPrep — Purchase"**:
   - Goal category: **Purchase** · Primary action (used for bidding)
   - Value: **"Use different values for each conversion"**, default **24 USD**
     (the code passes the real Stripe amount — $19 pass or first subscription
     charge — with a 24 USD expected average)
   - Count: **Every** · attribution: data-driven (default)
3. Create **"SpeechPrep — Report delivered"**:
   - Goal category: **Sign-up** (or a custom goal) · mark as **Secondary**
     (observation only — it feeds learning, not bidding)
   - Value: don't use a value · Count: **One**
4. For each action: **Tag setup → Use Google tag** → copy the **conversion ID
   + conversion label** and join them as `AW-18139578575/<label>`.
5. Set both in Vercel (Production env) and redeploy:
   - `NEXT_PUBLIC_GADS_CONVERSION_PURCHASE=AW-18139578575/<purchase-label>`
   - `NEXT_PUBLIC_GADS_CONVERSION_REPORT=AW-18139578575/<report-label>`
   (Also mirrored in `web/.env.example`.)
6. Verify: run a Stripe test purchase → Google Ads shows the conversion as
   "Recorded" within ~3 hours (Tag Assistant shows the hit instantly).
7. Note: the old hardcoded purchase label (`AW-18139578575/iM_JCO2GxKccEM-B0MlD`)
   was replaced by the env var. If you want to keep that existing conversion
   action, paste its label into `NEXT_PUBLIC_GADS_CONVERSION_PURCHASE`
   instead of creating a new one.
8. Local Google Ads MCP: authenticate first with
   `gcloud auth application-default login`, otherwise the MCP's
   customer/metadata/search tools fail with a credentials error.

---

## 6. Verifying /api/t (manual check)

The beacon route has no test harness (the repo has no test runner); verify by
hand after deploying — or locally with `pnpm dev`:

```bash
# 1. Allowlisted name → row lands
curl -s -X POST https://speechprep.ai/api/t \
  -H 'content-type: application/json' \
  -d '{"name":"demo_started","props":{"check":"manual"},"anon_id":"manual-check"}'
# → "ok"

# 2. Non-allowlisted name → dropped silently
curl -s -X POST https://speechprep.ai/api/t \
  -H 'content-type: application/json' \
  -d '{"name":"not_a_real_event","anon_id":"manual-check"}'
# → "ok" (by design: beacons always get 200)
```

Then in the Supabase SQL editor:

```sql
select name, props, anon_id, user_id, created_at
from events
where anon_id = 'manual-check';
-- expect exactly one row (demo_started); clean up with:
-- delete from events where anon_id = 'manual-check';
```

Also confirm client access is locked out: with the anon key,
`select * from events` must return zero rows and inserts must fail.
