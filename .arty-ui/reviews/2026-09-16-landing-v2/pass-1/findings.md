# Landing v2, critic pass 1 (2026-09-16)

Benchmark: the reference (folio-topaz-delta.vercel.app) for structure, Linear.com for craft, Zola for warmth. Graded cold by the builder against `arty-ui/references/critic.md`; measured in the DOM at 1440x900 and 390x844. Pane captures were used for the eye, DOM numbers for the record.

## First second
Desktop: reads as the reference's family immediately. Pill nav, serif display, muted subhead, two buttons, the product in a window. The difference from the reference is the right one: their window holds a screenshot, ours holds the running product with a script pane and a "what we're hearing" pane.

## Blind side-by-side
Closer to even than any previous pass. What gives ours away: the nav pill overlapping the eyebrow, and on mobile the Start button buried under the whole script.

## Measured
h1 Sentient 76px, 2 lines, one h1. Frame 1198px wide, top at 597px (above the fold, reference: 574). Two panes. Rails dashed. Nav sticky. Accent uses 2 in the read state (eyebrow dot + wavy underline; the third is the recording dot). No horizontal overflow at either width. Three `.cells` grids.

## Findings
1. **Sticky pill nav overlaps the hero eyebrow on desktop.** Hero top padding is 72px; nav is ~52px tall at top 12px. Spacing facet. Fix: 120px top padding on md+.
2. **Eyebrow wraps to two lines inside its pill on mobile.** Same finding as v1; the long specific-roles line came back with the centered hero. Fix: long text on md+, "For the wedding party" below.
3. **Mobile: the Start button is ~1.7 screens down**, below the entire script in the left pane. The page's single job is buried. Responsive facet. Fix: swap pane order under 768px so "what we're hearing" + Start come first, script second.

## Not findings
Frame chrome, cell grid, split heads, rails: all render as planned. `/demo` (page variant) still renders its own h1 and Start button.
