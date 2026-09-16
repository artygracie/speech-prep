# Landing page v2: reverse-engineering the reference, applied to Arty UI

Reference: https://folio-topaz-delta.vercel.app/ (a Ruixen UI template).
Read from the DOM at 1440x900 and 390x844 on 2026-09-16, not eyeballed.

## What the reference actually does

| Mechanism | Measured | Verdict for SpeechPrep |
|---|---|---|
| Floating pill nav | centered, ~880px, 1px #e6e6e6, 999px radius, logo / links / CTA | **Adapt** with house tokens |
| Centered hero stack | badge pill, serif h1 60px lh 1.0 weight 600, muted 20px subhead, ink button + outline button, tiny caption | **Adapt.** Badge = `.eyebrow`; buttons = `btn-primary` + `btn-light` |
| Product window frame | 1230px wide, 12px radius, 1px hairline, faint shadow, white, starts ~574px down, bleeds under the fold over a fading photo band | **Copy the frame; swap the photo for the house `.hero-bg`.** The frame holds the *live demo app*, not a screenshot |
| Dashed side rails | 1280px container, `border-x border-dashed #e6e6e6`, full page height | **Copy.** This is the page's grid personality |
| Split section heads | mono uppercase eyebrow, serif h2 48px left, one paragraph right | **Adapt.** Eyebrow = `.text-caption` (no mono in Arty UI) |
| Feature cells | hairline-separated grid cells, each with a small real mockup above title + two lines; larger bento cells for the important ones | **Copy.** Cells, not shadowed cards. Mockups must be real data shapes from the sample speech |
| Logo cloud, testimonials | present | **Skip.** No real logos, no real quotes; fake social proof is banned |
| Type | Geist body, Tiempos Headline display, Geist Mono eyebrows | General Sans body, **Sentient display**, caption-case eyebrows |
| Color | #171717 / #737373 / #e6e6e6 on white | ink / muted-ash / hairline on canvas. Accent stays phoenix, three uses |

## Two decisions this forces against the current guideline

1. **Serif display headlines on the marketing surface.** The guideline says one Sentient word per headline. The reference's entire identity is the serif display face; General Sans at 68px is what made v1 read "generic sans template" next to it. Proposal: on marketing pages, h1 and section h2 are set fully in Sentient italic; body and UI stay General Sans; inside the app nothing changes. Logged in the guideline as a 2026-09-16 decision, **flagged for Gracie**.
2. **The hero is centered, not split.** v1 used a 6/6 split with the demo on the right. The reference stacks: copy, then product full-width. Wider product, calmer copy. Adopted.

## Plan

Palette: canvas `#ffffff`, ink `#111111`, muted-ash `#6d6c6b`, hairline `rgba(17,17,17,.08)`, whisper `#f4f3ef` for one band, accent `#e8400d` exactly three times (eyebrow dot, one wavy underline, the recording dot).

Type: Sentient italic for h1 (clamp 44–72px, lh 1.0) and section h2 (clamp 34–48px); General Sans for everything else; `.text-caption` eyebrows.

Layout thesis: **the page is a drafting table with the rehearsal room set into it.** Dashed rails frame the whole page; the product window sits in the hero like a sheet on the table; everything below is hairline cells, no shadows.

```
[            floating pill nav             ]
:                                          :
:      ● For the wedding party             :
:        Give your best speech.   (serif)  :
:     Read it out loud once. SpeechPrep…   :
:     [Read one out loud] [See pricing]    :
:        About a minute. No account.       :
:  ┌──────────────────────────────────┐    :
:  │ ● ● ●  Best man speech for Tom  Ready│ :
:  ├────────────────┬─────────────────┤    :
:  │ script         │ what we hear    │    :
:  │ (four paras)   │ [Start reading] │    :
:  └────────────────┴─────────────────┘    :
:                                          :
: AFTER ONE READ          Three specific   :
: Three things come back  things…  (right) :
: ┌───────────┬───────────┬───────────┐    :
: │ mockup    │ mockup    │ mockup    │    :
: │ Timing    │ Diff      │ One thing │    :
: └───────────┴───────────┴───────────┘    :
: WHO IT'S FOR  four role cells            :
: PRICING       two cells + one sentence   :
: FAQ           split head + accordion     :
[ footer ]
```

Signature element: **the product window in the hero, running.** Script on the left, words landing on the right as the visitor speaks, the report replacing the right panel when they stop. A screenshot of an app is the reference's trick; the app itself is ours.

Benchmark for the critic: the reference itself for structure, Linear.com for craft, Zola for warmth.
