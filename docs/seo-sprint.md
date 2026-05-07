# SEO Sprint — SpeechPrep

> **Agent instructions:** This is a living document. Fill in the Product Context block first. Work through phases in order. Update task status inline as you complete them. Flag all Human Decision Points before proceeding past them. Log findings in the Audit table at the end of each sprint.
>
> This is not a rigid 90-day plan — phases are sprints. Run Phase 0 before launch. Run Sprint 1 immediately after. Sprints 2 and 3 follow when Sprint 1 is complete. Each sprint is roughly 2–4 weeks depending on capacity.

---

## Product Context

```
Product name:        SpeechPrep
Product URL:         https://speechprep.ai
Launch date:         TBD (Phase 2–5 still in progress)
One-line description: A rehearsal tool for prepared speech — upload your script, record yourself, get pacing analysis and AI coaching notes.
Target user:         Professionals, founders, students who give prepared speeches (pitches, talks, presentations)
Core pain solved:    No structured way to rehearse a written speech and get objective feedback on delivery vs. script
Top 3 competitors:   1. Speeko
                     2. Orai
                     3. Yoodli
Sprint start date:   2026-05-07
Agent working this:  Claude (Sonnet)
Last updated:        2026-05-07
```

---

## Sprint Dashboard

| Sprint | Status | Focus | Key Blocker |
|--------|--------|-------|-------------|
| Phase 0 — Pre-Launch | 🔄 In Progress | Tech foundation | Tasks 3–7 need Gracie action in GSC/Bing |
| Sprint 1 — Foundation | ⬜ Not Started | Tech audit + Keywords + Core pages | Phase 0 must complete first |
| Sprint 2 — Content Engine | ⬜ Not Started | Content + Backlinks | |
| Sprint 3 — Authority | ⬜ Not Started | Optimization + Clusters + Audit | |

**Status key:** ⬜ Not Started → 🔄 In Progress → ✅ Complete → 🚫 Blocked

**Current sprint:** Phase 0 — Pre-Launch
**Next agent action:** After Phase 0 tasks 3–7 are done by Gracie, run keyword research at outrank.so/seotools/keyword-research using seed terms: "speech practice app", "rehearse speech", "speech coaching tool", "pitch practice", "presentation rehearsal". Fill in keyword tracker and bring list to Gracie for approval.

---

## Phase 0 — Pre-Launch

> **Agent:** Complete all of these before launch day. These are not optional — missing items here will silently kill SEO for months.

### Technical Setup

| #   | Task                                                         | Status | Notes  |
| --- | ------------------------------------------------------------ | ------ | ------ |
| 1   | Set meta tags on every page (title, description, OG image)   | ✅      | Confirmed via metadata checker |
| 2   | Add `SoftwareApplication` + FAQ schema on homepage           | ✅      | Added to page.tsx as JSON-LD — 5 FAQs + full SoftwareApplication with all 3 pricing offers |
| 3   | Verify site in Google Search Console                         | ⬜      | GSC open — check verification status |
| 4   | Submit `sitemap.xml` to GSC                                  | ⬜      | sitemap.xml fixed (removed llms.txt + pricing.txt — not web pages) |
| 5   | Manually request indexing for 5 core pages in GSC            | ⬜      | Pages: TBD |
| 6   | Set up Bing Webmaster Tools (import from GSC — 2 min)        | ⬜      |        |
| 7   | Cross-link from any existing Artygroup property to this site | ⬜      | From:  |

### Copy

| # | Task | Status | Notes |
|---|------|--------|-------|
| 8 | Homepage H1 contains primary keyword | ⬜ | Keyword: TBD — needs keyword research first |
| 9 | All core pages have unique meta descriptions | ✅ | Confirmed |

**🙋 Human Decision Point:** Gracie reviews all copy before it goes live. Do not publish until approved.

**Phase 0 complete when:** All 9 tasks ✅. Log completion date: ___________

---

## Sprint 1 — Foundation

> **Agent:** Run this sprint immediately after launch. Estimated duration: 2–4 weeks. Goal: technical health + keyword strategy + 3 core pages live.

### S1-A: Technical Audit

> Run these checks against the live site. Log findings in the Notes column. Anything failing needs a fix before moving to keywords.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | `robots.txt` checked — no crawlers blocked | ✅ | Fixed — `.toLowerCase()` check (PR #29). Verified live: Allow: / with /app/, /auth/, /login disallowed. |
| 2 | All core pages confirmed indexed in GSC | ⬜ | |
| 3 | Page speed checked at pagespeed.web.dev | ⬜ | LCP score: |
| 4 | Core Web Vitals: LCP < 2.5s, CLS minimal | ⬜ | |
| 5 | Canonical tags confirmed on all key pages | ⬜ | Root layout has `canonical: "/"` — need to verify other pages once they exist |
| 6 | Alt text added to all images | ⬜ | Logo has alt="SpeechPrep" — need to audit LiveTranscript and other components |
| 7 | `noindex` added to login / dashboard / onboarding pages | ✅ | Added `robots: { index: false, follow: false }` to /login metadata and /app layout |

### S1-B: Keyword Strategy

> **Agent:** Find 20–30 keywords you can actually win. Winning = top 3 results have Domain Rating (DR) under 50. Use outrank.so/seotools/keyword-research or equivalent. Sort into intent buckets. Bring this list to Gracie for approval before writing any content.

**Intent buckets:**
- **Problem-Aware** — "how to [do thing]", "why is [problem] happening" → user doesn't know a solution exists yet
- **Solution-Aware** — "best tool for [use case]", "[product type] alternatives" → user is evaluating options (highest conversion priority)
- **Brand-Aware** — "[product] vs [competitor]" → user knows you or your competitor

**🙋 Human Decision Point:** Keyword list must be approved by Gracie before content is written.

#### Keyword Tracker

| Keyword | Vol/mo | Top 3 DR | Intent Bucket | Target Page URL | Pos Now | Pos S1 | Pos S2 | Pos S3 | Status |
|---------|--------|----------|---------------|-----------------|---------|--------|--------|--------|--------|
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |

**Status key:** ⬜ Not Yet / 🔄 Climbing (pos 11–20) / ✅ Top 10 / 🏆 Top 3

Identify 5 keywords for first content pieces (Solution-Aware first): ___________

### S1-C: Core Pages

> **Agent:** Build these 3 pages. Every Artygroup product needs all 3 before Sprint 2 begins. Use the approved keywords from S1-B.

**Page 1 — Homepage**
- [ ] Primary keyword in H1
- [ ] Primary keyword in first 100 words
- [ ] FAQ schema added
- [ ] Clear value prop in above-the-fold copy
- Keyword targeting: ___________

**Page 2 — Primary Use-Case Page**
- [ ] Targets one specific job-to-be-done
- [ ] Solution-Aware keyword in H1
- [ ] Internal link to homepage
- [ ] FAQ schema added
- Page URL: ___________ | Keyword: ___________

**Page 3 — First Comparison Page**
- [ ] Format: "[Product Name] vs [Competitor]" or "[Product Name] alternative to [Competitor]"
- [ ] Honest, specific comparison — not a hit piece
- [ ] Internal links to homepage + use-case page
- [ ] FAQ schema added
- Page URL: ___________ | Competitor: ___________

**After all 3 pages are live:**
- [ ] Internal links between all 3 pages confirmed
- [ ] All 3 pages appear in GSC as indexed

**🙋 Human Decision Point:** Gracie reviews all 3 pages before they go live.

**Sprint 1 complete when:** S1-A all ✅, keywords approved, 3 core pages live. Log date: ___________

---

## Sprint 2 — Content Engine

> **Agent:** Content + backlinks. Goal: 4+ posts published, 10 directories live, first backlink relationships started. Each post gets repurposed to at least 2 other channels same day.

### S2-A: Content Calendar

> Publish minimum 1 post per week. Prioritize formats in this order: comparison/alternative → use-case → pillar → pSEO. Repurpose every post to X (thread) and LinkedIn (post) on publish day.

| Week | Format | Target Keyword | Title | Status | URL When Live | X ✓ | LI ✓ |
|------|--------|---------------|-------|--------|--------------|-----|------|
| 1 | Comparison / Alternative | | | ⬜ | | | |
| 2 | Use-case | | | ⬜ | | | |
| 3 | Pillar post (2,000+ words) | | | ⬜ | | | |
| 4 | pSEO template or 2nd use-case | | | ⬜ | | | |

**Pillar post tasks:**
- [ ] 2,000+ words
- [ ] All existing posts link to this pillar
- [ ] Pillar links back to all supporting posts

**pSEO templates (if applicable):**
- [ ] Feature page templates live (e.g., "[Product] for [industry]")
- [ ] Alternative/comparison page templates live

**Format notes:**
- **Comparison/Alternative** — "[Competitor] alternative for [use case]" — high-intent, converts well
- **Use-case** — "How to [accomplish thing] with [product]" — builds trust, demonstrates value
- **Pillar** — 2,000+ words on the core topic — the gravity well for your whole content cluster
- **pSEO** — templated pages at scale — only do this if you can make them genuinely useful, not thin

### S2-B: Backlink Building

> **Agent:** Submit to directories first (passive backlinks). Then do founder outreach (link trades). Then guest posts. Log every submission below. Do not skip the log — the next agent needs to know what's pending.

**Target:** 10 live backlinks by end of Sprint 2.

#### Backlink Tracker

| Source / Domain | Type | Their DR | Status | Date Submitted | Date Live | Notes |
|-----------------|------|----------|--------|---------------|-----------|-------|
| producthunt.com | Directory | ~80 | ⬜ | | | |
| indiehackers.com | Community | ~72 | ⬜ | | | |
| alternativeto.net | Directory | ~75 | ⬜ | | | |
| saashub.com | Directory | ~62 | ⬜ | | | |
| betalist.com | Directory | ~58 | ⬜ | | | |
| stackshare.io | Directory | ~66 | ⬜ | | | |
| theresanaiforthat.com | Directory | ~55 | ⬜ | | | AI products only |
| futurepedia.io | Directory | ~52 | ⬜ | | | AI products only |
| topai.tools | Directory | ~44 | ⬜ | | | AI products only |
| startupbase.io | Directory | ~40 | ⬜ | | | |
| microlaunch.net | Directory | ~38 | ⬜ | | | |
| launched.io | Directory | ~35 | ⬜ | | | |
| crunchbase.com | Directory | ~91 | ⬜ | | | |
| g2.com | Directory | ~90 | ⬜ | | | Only after real users |
| capterra.com | Directory | ~88 | ⬜ | | | Only after real users |
| | Founder trade | | ⬜ | | | |
| | Founder trade | | ⬜ | | | |
| | Founder trade | | ⬜ | | | |
| | Guest post | | ⬜ | | | Target DR: 40+ |

**Status key:** ⬜ Not Started / 📤 Submitted / ✅ Live / ❌ Rejected

**Founder link trade tasks:**
- [ ] DM 3 founders in adjacent spaces: "I'll link to you from [URL] if you link to me from [URL]"
- [ ] Log agreed trades above

**Guest post tasks:**
- [ ] Identify 1 target blog (DR 40+, relevant audience)
- [ ] Pitch topic: ___________
- [ ] 🙋 **Human Decision Point:** Gracie approves pitch before sending

**Sprint 2 complete when:** 4 posts published, 10+ backlinks live. Log date: ___________

---

## Sprint 3 — Authority

> **Agent:** Find the quick wins (positions 8–20 that can jump to page 1), then build a content cluster for compounding. End with a full audit.

### S3-A: Position Optimization

> Open GSC. Export all keywords. Filter to positions 8–20 — these are one update away from page 1.

**Pages to optimize:**

| Page URL | Current Keyword | Current Position | Action Taken | New Position |
|----------|----------------|-----------------|--------------|-------------|
| | | | | |
| | | | | |
| | | | | |

**For each page in positions 8–20:**
- [ ] Add more depth to thin sections
- [ ] Add FAQ section with 3–5 questions from "People also ask"
- [ ] Improve heading structure (H2s that match related keyword variants)
- [ ] Add 1–2 new internal links from other pages

### S3-B: Content Cluster

> Pick one keyword theme. Build a pillar + 5–7 tightly linked supporting posts. This is how you compound.

**Cluster theme:** ___________
**Pillar keyword:** ___________

| Post | Target Keyword | Status | URL | Links to Pillar? |
|------|---------------|--------|-----|-----------------|
| Pillar | | ⬜ | | — |
| Support 1 | | ⬜ | | ⬜ |
| Support 2 | | ⬜ | | ⬜ |
| Support 3 | | ⬜ | | ⬜ |
| Support 4 | | ⬜ | | ⬜ |
| Support 5 | | ⬜ | | ⬜ |

**🙋 Human Decision Point:** Gracie approves cluster theme and pillar topic before content is written.

### S3-C: Sprint Audit

> Pull all metrics. Compare to baseline. Log here. Screenshot the % Growth column and share with Gracie.

| Metric | Baseline | Sprint 3 Result | % Growth |
|--------|----------|----------------|----------|
| **Traffic** | | | |
| Total organic impressions | | | |
| Total organic clicks | | | |
| Average CTR | | | |
| Average position | | | |
| **Rankings** | | | |
| Keywords in top 100 | | | |
| Keywords in top 10 | | | |
| Keywords in top 3 | | | |
| **Authority** | | | |
| Domain Rating (DR) | | | |
| Total referring domains | | | |
| Total backlinks | | | |
| **Content** | | | |
| Total pages indexed | | | |
| Blog posts published | | | |
| Comparison pages live | | | |

**Audit findings:**

```
What's working:

What's not working:

Biggest mover (keyword or page):

Recommended next sprint focus:
```

**Sprint 3 complete when:** Position optimization done, cluster published, audit filled in. Log date: ___________

---

## Agent Handoff Notes

```
Last session date:   2026-05-07
Last agent:          Claude (Sonnet)
What was completed this session:
  - robots.txt fix confirmed live (PR #29 merged) — verified at speechprep.ai/robots.txt
  - Fixed sitemap.ts — removed llms.txt and pricing.txt (not web pages)
  - Added SoftwareApplication + FAQPage JSON-LD schema to homepage (page.tsx)
  - Added noindex metadata to /login page and /app layout
  - Populated and updated this sprint doc

Current blockers:
  - Phase 0 tasks 3–7 require Gracie action (GSC verification, sitemap submit, indexing requests, Bing, cross-link)
  - Keyword research (S1-B) not started — blocks core page copy (Phase 0 task 8, S1-C)

Next action (be specific):
  1. Gracie: in GSC verify site is verified (task 3), submit sitemap.xml (task 4), request indexing for homepage (task 5)
  2. Gracie: set up Bing Webmaster Tools (task 6)
  3. Agent: run keyword research at outrank.so/seotools/keyword-research with seed terms below
  4. Agent: bring keyword list to Gracie for approval, then start S1-C core pages

Keyword seed terms to research:
  - "speech practice app", "speech rehearsal app", "rehearse a speech"
  - "pitch practice tool", "presentation rehearsal software"
  - "AI speech coach", "speech feedback app"
  - "how to practice a speech", "how to rehearse a presentation"
  - "Yoodli alternative", "Orai alternative"

Human input needed before next session can proceed:
  - Gracie to complete Phase 0 tasks 3–7 in GSC/Bing
  - Gracie to approve keyword list before any content is written
```
