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
│   └── src/proxy.ts                  # Auth-aware request proxy (Next 16)
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

Live in Supabase, version-controlled via `supabase` migrations (applied via the MCP for now). Phase-1 tables:

- `profiles` — mirrors `auth.users` with `plan` + `sessions_used`
- `speeches` — top-level row, points at the current `script_versions.v`
- `script_versions` — every save is a new row
- `sections` — children of a `script_versions` row, ordered by `position`
- `current_script` — read-side view that joins `speeches → current version → sections`

All tables have RLS policies that scope rows to `auth.uid() = user_id` (via the parent speech for nested tables).

## Build phases

This repo is being shipped phase by phase per the spec. Where we are:

- ✅ **Phase 1 — Foundation.** Next.js, Supabase, magic-link auth, dashboard + script editor.
- ⏳ **Phase 2 — Recording.** MediaRecorder + Storage + sessions table.
- ⏳ **Phase 3 — Transcription + pacing.** Deepgram edge function + Needleman–Wunsch alignment.
- ⏳ **Phase 4 — Diff + coach.** Anthropic API, prompt caching, iterative script update.
- ⏳ **Phase 5 — Pay.** Stripe, free-tier gating, billing portal.

## Deploy

Vercel. Connect this repo, set the two env vars, ship. Nothing about the code requires Vercel specifically — any Node host that runs Next.js works.
