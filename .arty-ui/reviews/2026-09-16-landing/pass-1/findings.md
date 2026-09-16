# Landing page, critic pass 1 (2026-09-16)

Benchmark: Stripe.com / Linear.com for craft, Zola for editorial warmth.
Graded by the builder, cold, against `arty-ui/references/critic.md`. The
independent critic subagent stalled on the previous attempt, so this pass is
self-graded per the skill's fallback. Screenshots were taken in-session via the
Browser pane at 1440x900 and 390x844 and are not persisted to disk, so
`annotate.mjs` was not run; markers below are described in words.

## First second
Desktop: "a real product page, with the product on it." The demo on the right
reads as product, not mockup. Then the eye lands on the headline and sees it
wrap five times.

## Blind side-by-side
Linear wins, on type discipline alone. The orphaned headline gives it away
before anything else is read. Everything below the fold would hold its own.

## Findings

1. **Hero headline, desktop.** `text-display` (up to 96px) in a 5-of-12 column
   wraps to five lines, orphaning "it." and "like." on their own lines. This is
   the single most visible flaw on the page. Typography facet. Fix: 6/6 split,
   and cap the hero display size so the two sentences hold as two visual
   groups.

2. **Hero on mobile pushes the demo ~1.4 screens down.** The page's one job is
   not on the first screen on a phone, which is where the best man is.
   Responsive facet. Fix: shorter eyebrow, drop the second hero paragraph on
   mobile, smaller display size at 390px.

3. **Card inside a card.** The demo's own `card-bordered` script panel sits
   inside a `card-elevated` wrapper, so the hero shows a bordered box inside a
   shadowed box. Tell-sheet, "cards inside cards". Fix: remove the wrapper's
   chrome; the demo's script card is the card.

4. **Mobile eyebrow wraps to two lines.** "FOR THE BEST MAN, THE MAID OF HONOR,
   AND THE PARENTS" breaks inside a pill. Fix: "For the wedding party"; the
   specific roles already have their own section.

5. **"What comes back" intro copy is negative listing.** "Not a score. Not
   'speak with confidence.' Things you can act on tonight." is the exact
   pattern the no-ai-slop rules ban (negative listing + dramatic fragments).
   Copy facet. Fix: "Each one is something you can act on tonight."

6. **Roles list, middle column, reads as filler.** "Three to five minutes."
   three times out of four rows. Repetitive and low-information under an h2
   that promises "its own way of going wrong". Fix: show each role's pitfall
   title instead, which is specific and differentiating.

7. **Pricing card header, mobile.** "Event Pass" breaks to two lines beside a
   two-line uppercase caption; cramped. Fix: let the header wrap so the
   caption drops under the name at narrow widths.

## Checked and not a finding
- The "what comes back" list appeared clipped at the right edge in the
  desktop capture. Measured in the DOM: verify before pass 2. (Result recorded
  in pass-2 findings.)
- Accent appears exactly three times (eyebrow dot, one wavy underline, one
  .hl). Nav is flat white with a hairline, not glass. One h1. No horizontal
  overflow at either width.
