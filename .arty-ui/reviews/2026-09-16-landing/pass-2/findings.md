# Landing page, critic pass 2 (2026-09-16)

Same benchmark and method as pass 1. Measured in the DOM at 1440x900 and
390x844 rather than trusting pane captures, which shrank mid-session.

## Pass-1 findings, re-checked
1. Hero headline: 3 lines at 68px, no orphans (was 6 lines at 96px). Fixed.
2. Mobile demo position: top of the demo card is on the first screen at 0.58
   screens down (was 0.76 with the card top cut). Fixed.
3. Nested cards: none inside `#try`. Fixed.
4. Mobile eyebrow: single line. Fixed.
5. Negative-listing copy: replaced. Fixed.
6. Roles middle column: now each role's pitfall title. Fixed.
7. Pricing card header on mobile: name and caption stack cleanly. Fixed.
Suspected clip on the "what comes back" list: measured right edge 1293px in a
1440px viewport. Not a finding; the capture was cropped.

## First second, pass 2
Mobile above-fold reads as designed for the phone: eyebrow, three-line
headline with one italic word, one paragraph, and the product starting on
screen one. This is the shot to put beside Zola.

## Remaining finding
8. "The part that runs long is almost always the story." reads as a weasel
   generalisation. Copy facet. Fixed in the same pass: "It is usually the
   story that runs long."

## Verdict
SHIPPABLE. The page has one signature element no competitor has (the real
product running in the hero), disciplined quiet around it, the accent earned
exactly three times, one Sentient word per headline, and four sections that
each have a different structure. It belongs next to the benchmark on the
strength of the hero; the sections below hold rather than lead.

## Not assessed in this pass
Interaction states inside the demo (recording, working, report) on the
landing page, because mic capture is blocked in the review browser. The
demo's own states were verified when it was built; embedding does not change
them, but a real run on the preview deploy is still owed.
