# Landing v2, critic pass 2 (2026-09-16)

## Pass-1 findings, re-checked (DOM measurements, 1440x900 / 390x844)
1. Nav overlap: eyebrow top 177px, nav bottom 69px. Fixed (`.hero-top` 120px on md+).
2. Mobile eyebrow: one line, "For the wedding party". Fixed.
3. Mobile pane order: "what we're hearing" + Start first, script second. Start at 1.03 screens (frame bar at the fold). Fixed.

Frame top 645px on desktop, above the fold (reference: 574). h1 Sentient 76px, two lines. No overflow at either width. `/demo` page variant unchanged.

## Process note
The first re-check after these fixes showed none of the CSS changes applied, even after a dev-server restart. Cause: a stale `.next` compile of globals.css; the served chunk was byte-for-byte the pre-edit version. Clearing `.next` fixed it. Recorded so the next person doesn't spend twenty minutes on it.

## Verdict
SHIPPABLE. Side by side with the reference: same skeleton (pill nav, centered serif stack, product window, dashed rails, split heads, hairline cells), and one thing the reference cannot show, the product running inside the window. What still separates it from Linear is the copy density of the lower sections, which is a next-pass concern, not a shipping blocker.

## Not assessed
Recording, working, and report states inside the framed demo (mic capture blocked in the review browser). The pane logic is shared with the verified `/demo` variant, but a real run on the preview deploy is still owed.
