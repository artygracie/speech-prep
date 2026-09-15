# Critic pass 1 — wedding-first marketing surfaces
_2026-09-14 · homepage `/` and role page `/best-man-speech` · desktop 1440x900_

**Process note.** The intended fresh-eyes subagent critic stalled (browser-pane
contention) and was not recovered. This pass was graded by the builder against
`references/critic.md`, which the skill permits as the fallback. It is therefore
weaker evidence than an independent pass — a second, genuinely blind pass is
worth running before this is treated as final. Several facets below are marked
NOT ASSESSED rather than being quietly claimed.

## 1. The first second

Confident and editorial. The headline does real work: tight tracking at display
size, and the single Sentient italic word ("sounds") lands on the word that
carries the meaning rather than on a decorative article. It does not read as a
template, and it does not read as the universal AI hero — there is no centered
stack, no filled-plus-outline button pair.

## 2. The blind side-by-side

Against Stripe.com and Linear.com for craft, Zola/Minted for warmth: the type
holds its own. What lost it points, before fixes, was not craft but *intent* —
the page was arguing with itself about what it wanted the visitor to do.

## 3. Findings

### 1. The nav CTA pointed at the wall the page exists to remove — FIXED
- **Where:** header, top right, desktop and mobile.
- **What & why:** the most prominent button on the page was an ink-filled
  "Begin" going to `/login`. The page's single job is to get someone to read a
  speech out loud at `/demo`. Two competing primary CTAs, and the more visually
  dominant one led to the exact login gate that 77% of signups never got past.
  Facet: consistency, and the playbook's "asking for the click before earning
  the promise".
- **Fix applied:** nav CTA is now "Try it" → `/demo`; sign-in demoted to a quiet
  `.nav-link`. One primary ask per page, matching the hero.

### 2. Nothing linked to the role pages — FIXED
- **Where:** homepage, between hero and premise.
- **What & why:** the four role landing pages are where the search demand
  actually lands, and no internal link reached them. Bad for a reader who
  arrived on the homepage and needs their specific role, and bad for crawl:
  sitemap-only discovery is weak internal linking.
- **Fix applied:** a "Which speech are you giving?" strip of four `.role-chip`
  pills. Deliberately pills rather than buttons — they are navigation into
  reading, not the page's primary action, so they must stay quieter than
  `btn-primary`.

### 3. Role chip labels were lowercase sentence fragments — FIXED
- **What & why:** derived by string-replacing the eyebrow copy, producing
  "best man" rather than "Best man". Reads as a bug, not a style.
- **Fix applied:** chips use `role.occasion`, which is already correctly cased
  and is the same vocabulary as the in-app occasion picker.

## 4. Checked and deliberately NOT flagged

- **Hero gradient.** Matches the Arty UI `.hero-bg` spec exactly (opacity 0.5,
  blur 70px). The tell-sheet flags gradient meshes, but this is the documented
  house mechanism with the product's own claimed accent, so it is a brand
  decision rather than slop.
- **01/02/03 markers** in the how-it-works section. The tell-sheet flags these
  on content that is not a sequence. Here it is a genuine four-step sequence.
- **Blank mid-page screenshots.** Investigated; the DOM is present at opacity 1.
  A Browser-pane compositing artifact, not a page defect.

## 5. NOT ASSESSED in this pass

- **Mobile (390px).** Not captured. The role page was seen at ~710px only.
- **Interaction states.** Hover/focus/active have defined CSS but no screenshot
  evidence, which the sheet requires.
- **The three other role pages.** Only `/best-man-speech` was reviewed; the
  other three share the same component, but their copy differs and was not read
  cold.

## Verdict

**FINDINGS** — three found, three fixed. Not awarded SHIPPABLE: a builder-graded
pass with mobile and states unassessed does not meet the bar the sheet sets for
that verdict.
