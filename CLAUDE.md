# SpeechPrep: agent entry point

The app is in `web/` (Next.js, **pnpm**). Read [web/CLAUDE.md](web/CLAUDE.md) and
the `AGENTS.md` it references for how the app itself works. This file exists for
what a session needs before it gets that far, including a cloud session, which
sees only what this repo carries.

## Artygroup context

Gracie Redfern's global agent context lives at `~/.claude/CLAUDE.md` on her
machine, which a cloud session never sees, and the `artygroup-os` plugin does not
load there either. The part that governs work in this repo:

- Artygroup is a holding company for a portfolio of micro-SaaS products, founded
  by Gracie Redfern, Los Angeles. SpeechPrep is one of them.
- **The 70% rule.** Skills and agents handle 70% of a task. Gracie owns the final
  30%: judgment, taste and approval. Flag Human Decision Points instead of
  deciding them, and never ship copy, design or a business decision without her
  sign-off.
- Principles: build maintainable products for the next agent reading cold; give
  tangible value; it must be beautiful; industrial-engineer it; communicate and
  document; experiment.
- The engineering bar: elegant (the smallest change that fully solves it),
  maintainable (written for the next agent reading cold), non-redundant (one home
  per fact), logical (invalid states unrepresentable), robust (validate at
  boundaries, never swallow errors).
- The day's priorities live in Linear. A cloud session usually cannot read it, so
  ask rather than guess at priority.

## This repo uses pnpm

`web/pnpm-lock.yaml` is the lockfile, so `npm ci` cannot install this project.
Use `pnpm install --frozen-lockfile` from `web/`. The cloud setup script picks the
package manager off the lockfile, so it gets this right without being told.

## Cloud sessions

[os/cloud-environment.md](os/cloud-environment.md) is the runbook.
