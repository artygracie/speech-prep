# Cloud sessions for SpeechPrep

How to run Claude Code in the cloud against this repo. The generic standard is the
Artygroup OS skill `skills/cloud-sessions/SKILL.md`; this file is only what is true
of SpeechPrep.

Written 2026-09-24.

## The environment, once

| Field | Value |
| --- | --- |
| Name | `SpeechPrep` |
| Network access | `Full`, or `Custom` with the defaults plus `*.supabase.co`, `api.anthropic.com`, `api.deepgram.com`, `*.sentry.io` |
| Environment variables | the `NEXT_PUBLIC_*` lines, see below |
| Setup script | the contents of `.claude/cloud-setup.sh` |

## Two things this repo does differently

- **pnpm, not npm.** `web/pnpm-lock.yaml` is the lockfile. `npm ci` fails outright
  here. The setup script reads the lockfile to pick the package manager, so the
  same script text works in every Artygroup environment.
- **The app is in `web/`,** and the repo root has no `package.json`. The script
  finds the app by looking for the lockfile rather than by being told.

## What goes in which box

The variables box is readable by anyone using the environment. An **API
credential** is held outside the VM and attached by Anthropic's proxy to requests
for the hosts you name. Choose by **how the value is consumed**:

| Variable | Home | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN` | Environment variables | Next inlines them into the client bundle; public by design |
| `ANTHROPIC_API_KEY` | Environment variables, only for a session that needs the model | `api.anthropic.com` never receives an API credential, so there is no other home. Billable: add it for the session, remove it after |
| `DEEPGRAM_API_KEY` | API credential | `api.deepgram.com`, `Authorization` header, prefix `Token` |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DSN` | Leave out | Release and sourcemap uploads. A sandbox has no business writing production releases |
| `COACH_TRIGGER_SECRET` | Leave out | Verifies an inbound trigger; a session never receives one |

```bash
grep -E '^NEXT_PUBLIC_' web/.env.local | pbcopy
```

## The gate

No git hooks here, so nothing runs on push. The gate is what you run, from `web/`:
`pnpm lint`, `pnpm test` (vitest), and `pnpm build`.

## Getting work back

The session clones the branch as GitHub has it and can push only to that branch,
so push before tasking it.
