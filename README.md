# SpeechPrep

The room before *the* room.

A rehearsal tool for prepared speech. Upload your script, record yourself giving it, and get back per-section pacing, a what-you-said-vs-what-you-wrote diff, and AI coaching notes. The product spec lives at [artyfacts.ai/a/09ee5eaf-...](https://artyfacts.ai/a/09ee5eaf-eacc-4c72-8559-9c87c47126c7).

## Repo layout

```
speech-prep/
├── web/                              # Next.js 16 app — the real product
│   ├── src/app/                      # App Router routes
│   │   ├── page.tsx                  # Landing (/)
│   │   ├── login/                    # Magic-link sign-in (/login)
│   │   ├── auth/callback/route.ts    # OAuth code exchange
│   │   ├── app/                      # Authed routes (gated by proxy.ts)
│   │   │   ├── page.tsx              # Speeches dashboard
│   │   │   ├── speeches/
│   │   │   │   ├── new/              # Create-a-speech form
│   │   │   │   └── [id]/             # Speech detail + /edit document editor
│   │   │   └── settings/
│   │   └── _landing/                 # Landing-only client components
│   ├── src/lib/supabase/             # Server / browser / proxy clients
│   ├── src/types/database.types.ts   # Generated from the live schema
│   ├── src/proxy.ts                  # Auth-aware request proxy (Next 16)
│   └── supabase/migrations/          # Schema source of truth (see below)
├── docs/                             # Operating docs — analytics, PRDs, research
├── assets/                           # Brand assets — wordmark + logo
├── index.html                        # Static landing demo (predecessor)
├── app.html                          # Static app demo (predecessor)
└── README.md
```

The two static `.html` files are the original clickable demo. They stay in the repo as design source-of-truth — the Next.js port reproduces them piece by piece.

## Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19**
- **TypeScript**
- **Tailwind 4** (with bespoke design tokens in `globals.css`)
- **Supabase** for auth, Postgres, RLS

## Local development

You need: Node 20+, pnpm 10+, a Supabase project.

```bash
cd web
cp .env.example .env.local        # then paste your Supabase URL + anon key
pnpm install
pnpm dev                          # http://localhost:3000
```

The Supabase project URL and publishable key are read from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Row-level security policies guarantee a user can only ever read their own speeches; the client-side anon key is safe to ship.

To regenerate the TypeScript types after a schema change:

```bash
# either from the Supabase MCP, or:
pnpm dlx supabase gen types typescript --project-id <id> > src/types/database.types.ts
```

## Schema

Live in Supabase; `web/supabase/migrations/` is the source of truth:

- `20260714000000_baseline.sql` — the full live schema, reconstructed via
  read-only introspection (the original phase migrations were applied via the
  MCP and never committed). Tables: `profiles`, `speeches`, `script_versions`,
  `sections`, `sessions`, `transcripts`, `section_metrics`, `ai_reports`.
  Views: `current_script`, `entitlements`, `session_summaries`. Plus RLS
  policies, triggers (incl. `handle_new_user` on `auth.users`), and the
  private `recordings` storage bucket.
- `20260714000100_events_and_attribution.sql` — first-party funnel `events`
  table (server-write only) + `profiles.attribution` (first-touch UTM/gclid).

All user tables have RLS policies scoping rows to `auth.uid() = user_id`
(via the parent speech for nested tables). Funnel queries and health checks
live in [`docs/analytics.md`](docs/analytics.md).

## Status

All five build phases from the original spec shipped in May 2026:

- ✅ **Phase 1 — Foundation.** Next.js, Supabase, magic-link auth, dashboard + script editor.
- ✅ **Phase 2 — Recording.** MediaRecorder + Storage + sessions table.
- ✅ **Phase 3 — Transcription + pacing.** Deepgram edge function + alignment.
- ✅ **Phase 4 — Diff + coach.** Anthropic API coach reports with suggested edits.
- ✅ **Phase 5 — Pay.** Stripe ($12/mo Practiced, $19 single-speech pass), free-tier gating, billing portal.

The product is live at [speechprep.ai](https://speechprep.ai). Current work
is the **relaunch**: fixing the recording→report pipeline, adding funnel
analytics + attribution (see `docs/analytics.md`), and relighting Google Ads.

- Relaunch strategy: [artyfacts.ai/a/a6c4baa0-…](https://artyfacts.ai/a/a6c4baa0-a4eb-4d58-8af1-aa246edfa894)
- Implementation plan: [artyfacts.ai/a/43a439f5-…](https://artyfacts.ai/a/43a439f5-bbbf-40e2-8d58-6ce5fca9fa5b)

## Deploy

Vercel. Connect this repo, set the env vars from `web/.env.example`, ship. Nothing about the code requires Vercel specifically — any Node host that runs Next.js works.
