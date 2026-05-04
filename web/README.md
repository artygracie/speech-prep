# web — SpeechPrep Next.js app

The production app. See the repo root [README](../README.md) for the full
project layout, stack, and build phases.

## Quick start

```bash
cp .env.example .env.local        # paste Supabase URL + anon key
pnpm install
pnpm dev                          # http://localhost:3000
```

## Environment

| Var | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase publishable/anon key |
| `NEXT_PUBLIC_INDEXABLE` | prod only | Set to `"true"` on launch day to allow search indexing. Anything else blocks crawlers via `robots.txt`, `X-Robots-Tag` header, and meta robots. |

## Notes

- Next.js 16 with the App Router. `proxy.ts` (renamed from `middleware.ts` in
  v16) refreshes Supabase auth on every request and gates `/app`.
- Auth: magic-link via Supabase. Codes are exchanged at `/auth/callback`.
- Tailwind 4 with bespoke tokens in `globals.css`.
- SEO surface: `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx`,
  and security headers in `next.config.ts`. All gated by `NEXT_PUBLIC_INDEXABLE`.
