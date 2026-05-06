# PRD: Lifecycle Coaching for Speech Memorization

**Author:** Claude (with Grace Williams)
**Status:** Implementation in progress
**Last updated:** 2026-05-05
**Branch:** `claude/lifecycle-coaching-v1`

---

## 0. TL;DR

speechprep.ai today is a *session tool*: pick a mode (Script visible / From memory), record, get a report, repeat. The user has to know what to do next.

This PRD turns it into a *coaching companion*. From upload to delivery, the platform tells the user what to do next, grounded in memorization science and the user's own performance signals. The user can always override; we never block.

We are **not** building a state machine on speeches. We compute a recommendation each time the user lands on a relevant page, derived from existing signals (sessions, modes, memory bands, recall trend, recency).

The 5-day plan implied by the research becomes the default *trajectory*; the recommendation engine adapts to where the user actually is in that arc.

---

## 1. Background

### 1.1 What we have today

- A user can upload a speech, edit sections, and record sessions.
- Each session has a mode: **Script visible** (with-script) or **From memory** (freestyle).
- After each session, the AI coach produces a report with: a headline, a summary, per-section notes, and suggested edits (cut / adopt / rephrase / drill).
- The session report shows the manuscript with inline track-changes overlays for coach edits and speaker deviations.
- Recording supports section-scoped practice (a "practice this section only" toggle in the recorder UI).

### 1.2 Why it's not enough

The user has to drive everything:
- They choose mode every time. There's no signal that "you should try Script visible first" or "you're ready for From memory."
- The session report optimizes for *editing the script* even when the user is past the editing phase and trying to memorize.
- Memorization is a multi-day project. Today the app forgets what the user did yesterday — every session is its own island. There's no concept of progression.
- When the user blanks (as in the screenshot from the conversation that prompted this PRD), the report shows "rephrase" cards that don't make sense for memorization. We patched that in PR #19, but the underlying issue — the report has no idea what the user is *trying to do* — remains.

### 1.3 What the science says

A separate research synthesis (saved alongside this PRD as `docs/memorization-research.md`) covers the literature in detail. The headlines that drive product decisions:

- **Distributed practice ≫ massed.** 4×30min over 4 days is dramatically better than one 2-hour cram. The user's existing 15–30min pockets are exactly right; we should never tell them to find a longer block.
- **Retrieval ≫ rereading** for long-term recall. Once the script is familiar, every additional read-aloud is worse than a recall attempt.
- **Production effect.** Out-loud rehearsal beats silent by 10–20%.
- **Lock the script early.** Each edit resets memory for the affected section. Practitioners converge on locking by Day 2.
- **Cumulative part method** beats isolated chunk drilling, because transitions get more reps.
- **Anchors matter.** First and last lines disproportionately affect confidence (serial position effect). The opener and the toast/closing line should be over-learned.
- **Sleep within ~3 hours of practice** consolidates 2× better than morning-then-day-off.
- **Cold starts** in the last 2–3 days are the highest-transfer rep — practice the state you'll perform in.
- **Don't over-rehearse.** Overlearning has no long-term benefit (Rohrer & Pashler), and rep #20 the day before raises anxiety more than it helps recall.

### 1.4 The user

**Daniel.** Mid-30s professional. Has a wedding toast for a colleague in 5 days. Has 15–30 min practice pockets. Used to giving talks with slides — *not* used to memorizing prose. Wants to feel taken care of: wants the platform to tell him what to do next without making him feel managed.

---

## 2. Goals & non-goals

### 2.1 Goals

1. **Always recommend a clear next action.** On the speech detail page, on the post-session report, the user sees a single primary recommendation with a short rationale. No guessing.
2. **Adapt the recommendation** to where they are in the arc — script-tightening phase, memorizing phase, polishing phase — derived from existing signals.
3. **Make the From-Memory report useful for memorizing**, not editing — recall verdict per section, drill plan, anchors, no Accept/Reject framing.
4. **Don't block.** Every recommendation has an "I want to do something else" escape hatch.
5. **Ship as a focused PR.** One coherent feature, lint+typecheck clean, no schema migrations, no half-finished surfaces.

### 2.2 Non-goals (this PR)

- **No new database columns or migrations.** Recommendations are derived; we can persist later if it earns its keep.
- **No streak / engagement gamification.** The science says distributed practice; we'll surface that gently, but no badges, no Snapchat-style streak shame.
- **No multi-take trend visualizations.** Per-speech progression *data* will be designed for, but charts are out of scope. We have a `ConvergenceChart` already; we'll piggyback when natural and not before.
- **No notifications / reminders.** The "practice within 3 hours of bed" insight is design-noted but not delivered as a push notification this round.
- **No mobile-specific UX.** Existing responsive layout stands.
- **No payment changes.** Free-plan / single-speech-pass gating is preserved exactly as is.
- **No event-date capture this round.** The research recommendations are time-aware ("if days-until-event ≤ 2, switch to cold starts"), but capturing the event date is its own surface area. We'll write the recommendation logic to *accept* a `daysUntilEvent` input, default to `null`, and use take-count + recall trend as proxies. Event date capture is the natural follow-up.

### 2.3 Success criteria

- A user landing on a speech detail page after recording a take **always sees a specific, contextual recommended next action** (not just "Record session").
- A user who blanked a freestyle take sees a **recall verdict + drill plan**, not a list of "edit your script" suggestions.
- A user can ignore the recommendation and pick any mode/section combination they want — recording still works as it does today.
- Lint, typecheck, and a manual walk-through of the four core flows (script-edit → recommendation, with-script take → recommendation, freestyle take blanked → recommendation, freestyle take word-perfect → recommendation) all pass.

---

## 3. The phases (informal)

These are *recommendation phases*, not persisted states. They are computed from signals, and the boundary between phases is a soft band — a user can jump back if they edit the script, or skip ahead if they're already memorized on first try.

| Phase | Signal | Default recommendation |
|---|---|---|
| **Familiarize** | 0 sessions on current script version | "Read the script aloud, with it visible. We'll tell you if it lands." → **Script visible**, full speech |
| **Tighten** | 1+ Script-visible sessions, coach has produced ≥1 cut/adopt/rephrase edit on current version | "Apply the edits you like, then run it again." → Apply → **Script visible**, full speech |
| **Lock** | 2+ Script-visible sessions on the current version, coach hasn't surfaced a substantive new edit | "The script is in good shape. Time to start memorizing." → **From memory**, section-by-section |
| **Memorize: section** | Memorize phase entered, has at least one weak (rough/blanked) section | "Drill the weakest section." → **From memory**, scoped to that section |
| **Memorize: cumulative** | Most sections word-perfect or mostly-there | "Run the whole speech from memory." → **From memory**, full speech |
| **Polish** | Most recent freestyle takes ≥80% recall | "Record one cold-start full run." → **From memory**, no warm-up framing |
| **Done** | 3+ consecutive freestyle takes ≥85% recall | "You've got it. Stop drilling. One light run tomorrow if it helps." |

Crucially: **the user never sees these phase names**. They just see the recommendation.

---

## 4. User stories

### 4.1 Persona: Daniel (recap)

5 days to a wedding toast. 15–30 min pockets. Standing-and-projecting practice; standing while typing this PRD; you get the idea. Wants to be taken care of.

### 4.2 Stories

#### Phase: Familiarize / Tighten
- **US-1.** As Daniel arriving fresh to a new speech, I want a "Try a Script-visible take first" recommendation, so I learn how my writing actually sounds before trying to memorize it. *Existing behavior is good but not framed as a recommendation.*
- **US-2.** As Daniel after a Script-visible take that produced coach edits, I want a recommendation to apply edits and re-record, so I lock in writing that lands. *(Existing "Apply & record again" is good; we surface it more prominently.)*
- **US-3.** As Daniel after 2+ Script-visible takes with no new substantive edits, I want a recommendation to **lock the script and start memorizing**, so I don't keep tinkering with writing forever (research: edits reset memory traces).

#### Phase: Memorize
- **US-4.** As Daniel ready to memorize, I want to be **directed to one section at a time** (the cumulative part method), so I'm not overwhelmed by the whole 2 minutes at once.
- **US-5.** As Daniel having drilled one section, I want to be told to **add the next section** and run them together, so I'm practicing the bridge between them. *(Cumulative part method.)*
- **US-6.** As Daniel who blanked a section, I want to see **what the script line is that I should have said** (re-anchoring to the script) and a concrete drill plan, **not** a "rephrase" suggestion that proposes to rewrite my speech.
- **US-7.** As Daniel who paraphrased successfully, I want the report to say "you got the gist — try once more from memory" rather than punishing me for not being verbatim.
- **US-8.** As Daniel polishing my speech, I want a recommendation to **record a cold-start take** (no warm-up, just go), because that's the highest-transfer rep — and the platform should explain that briefly so I trust it.

#### Phase: Cross-cutting
- **US-9.** As Daniel returning the next day, I want the platform to **remember where I am** (recommend the next thing in the arc), not just dump me on a generic Record button.
- **US-10.** As Daniel, I always want a clear **escape hatch** — "Record something else" — so I don't feel boxed in.
- **US-11.** As Daniel, I want the **rationale** for each recommendation in one short sentence, so I trust the platform isn't just guessing.
- **US-12.** As Daniel, I want recommendations to **stop scolding me** about paraphrasing in From-Memory mode — when my brain filled a gap with similar words, that's a sign I retained meaning, which is good.

#### Phase-specific report behavior
- **US-13 (Script-visible report).** Same as today. The session report optimizes for editing the script.
- **US-14 (From-Memory report).** Different shape from today: top section is a **recall scoreboard**, the rail is **drill-first** (one drill per weak section), the script is shown for re-anchoring on blanked sections rather than for editing.
- **US-15 (From-Memory report).** Suppress Accept/Reject framing entirely on freestyle reports unless the coach has a *non-zero* count of high-quality script edits (rare in this mode per research).

### 4.3 Out of scope this round (with rationale)

- **US-EX1.** Multi-take trends per section — *valuable but separate surface; out of scope*.
- **US-EX2.** Event date capture and `daysUntilEvent`-aware recommendations — *promising next iteration; we plumb the input but default to `null` and use proxies*.
- **US-EX3.** Sleep-window nudges, push notifications — *requires notification infra*.
- **US-EX4.** Anchor-line auto-detection (first sentence, last sentence) and dedicated anchor drills — *good idea, but the section-level recommendation engine is the core spine; anchor-level treatment is a v2 layer on top*.
- **US-EX5.** Difficulty mode ladder (script visible → first-letter view → free recall → cold start) — *first-letter view is its own UI surface; out of scope*.

---

## 5. The recommendation algorithm

This is the heart of the feature.

### 5.1 Inputs

For a given speech, on a given page, we need:

```ts
type RecommendationInput = {
  speechId: string;
  currentVersion: number;         // speech.current_version
  sessions: Array<{
    id: string;
    mode: SessionMode;
    versionAtTime: number;        // session.script_version's `v`
    createdAt: Date;
    memoryBands: Array<{ sectionId: string; band: MemoryBand }>;
    suggestedEditCount: { cut: number; adopt: number; rephrase: number; drill: number };
  }>;
  sections: Array<{ id: string; name: string; position: number }>;
  daysUntilEvent: number | null;  // not collected today; default null
};
```

### 5.2 Output

```ts
type Recommendation = {
  // Shown to the user.
  headline: string;             // "Lock the script and start memorizing"
  rationale: string;            // one sentence: WHY
  primaryAction: {
    label: string;              // "Drill Story from memory"
    href: string;               // "/app/speeches/{id}/record?mode=freestyle&section={sid}"
  };
  // Also shown but smaller.
  secondaryActions?: Array<{ label: string; href: string }>;
  // Tagged for telemetry / debugging — not user-visible.
  phase: RecommendationPhase;
  signals: string[];            // e.g. ["2_with_script_takes", "no_new_substantive_edits"]
};
```

### 5.3 Decision tree (in priority order)

```
Step 1 — No sessions on current version.
  → Phase: Familiarize
  → Recommend: Script visible, full speech.
  → Rationale: "Read it aloud first. We'll tell you what's working."

Step 2 — Most recent session is Script-visible AND has ≥1 unaccepted high-priority script edit
        AND it's the user's *latest take overall* (we don't nag if they recorded after).
  → Phase: Tighten
  → Recommend: open report → apply edits → re-record Script visible.
  → Rationale: "You have edits worth applying. Try the new version."

Step 3 — ≥2 Script-visible sessions on current version, latest produced no new substantive edits.
  → Phase: Lock → memorize
  → Recommend: From memory, scoped to first section.
  → Rationale: "The script is in good shape. Time to start memorizing — one section at a time."

Step 4 — Most recent session was From-memory.
  Substep 4a: Score recent recall trend (last 1-2 freestyle takes).
    - Compute weakest section (lowest band, ties broken by position).
    - Compute "all sections at mostly-there or better" boolean.
    - Compute "all sections word-perfect on most recent" boolean.

  4a-i: Weakest section is blanked or rough.
    → Phase: Memorize: section
    → Recommend: From memory, scoped to that section.
    → Rationale: "Drill {section name} — that's where you blanked."

  4a-ii: All sections at mostly-there or better, but not all word-perfect.
    → Phase: Memorize: cumulative
    → Recommend: From memory, full speech.
    → Rationale: "Strong on each section — try the whole speech now."

  4a-iii: All sections word-perfect on the most recent take.
    → Phase: Polish
    → Recommend: From memory, full speech, "cold start" framing.
    → Rationale: "You've got it. Run it cold — that's the rep that transfers to game day."

  4a-iv: 3+ consecutive freestyle takes word-perfect.
    → Phase: Done
    → Recommend: Stop drilling. Optional light run tomorrow.
    → Rationale: "Your memory is locked. Over-rehearsing now hurts more than it helps."

Step 5 — User just edited the script (current_version increased since last session).
  → Phase: Familiarize (forced reset)
  → Recommend: Script visible, full speech, against the new version.
  → Rationale: "You changed the script. Run it again — it'll feel different."

Step 6 — Catchall (shouldn't fire if above are exhaustive).
  → Phase: Tighten (default)
  → Recommend: Script visible, full speech.
  → Rationale: "Run it again."
```

### 5.4 Concrete signals → phase mapping

```ts
function recommendNext(input: RecommendationInput): Recommendation;
```

The function lives in a new module `web/src/lib/lifecycle.ts`. It is **pure** — no I/O, no time except via `Date.now()` for staleness checks. We test it by hand and (deferred) write unit tests.

### 5.5 Boundary conditions

- **Empty speech (no sections).** Recommendation: edit the script first. Don't suggest recording.
- **Very long speech.** Section-by-section guidance still applies; the script-tightening phase may take more sessions. No cap on number of sections.
- **Free plan exhausted.** The recommendation still shows, but the primary action's button is disabled with the existing UpgradeCard pattern.
- **First time the user records ever.** Same as Familiarize.
- **Coach hasn't finished generating yet.** Recommendation hides; the existing "Coach is writing your feedback…" pill is shown instead.
- **All sections "not-reached" on a freestyle take.** That means the user gave up partway. Recommend a Script-visible run-through to re-encode rather than throwing them back into freestyle.

---

## 6. Surfaces (UI changes)

### 6.1 Speech detail page (`/app/speeches/[id]`) — primary recommendation surface

**Add:** a `NextStepCard` rendered above (or replacing) the existing two-button "Print / Edit script / Record session" group. The card shows:

```
─────────────────────────────────────────────
NEXT STEP
{Headline}
{Rationale}

[ Primary action button (large) ]   [ I want to do something else ▼ ]
─────────────────────────────────────────────
```

The "I want to do something else" expandable lists the standard options (Script visible / From memory, optionally section-scoped). Free escape hatch.

If the user hasn't recorded any session yet, the card is the headline of the page. If they have, it sits between the title and the script preview. The original "Record session" button moves into the secondary menu.

### 6.2 Session report page (`/app/speeches/[id]/sessions/[sid]`)

**Two cases:**

**With-script reports** — visually unchanged. Add a `NextStepCard` at the bottom of the page (after the manuscript), so the apply-edits-and-record-again loop is clear. The existing "Apply to script only" / "Apply & record again" buttons stay — the NextStepCard is a parallel surface emphasizing what to do *after* applying.

**From-memory reports** — restructured.
1. **Top: recall scoreboard.** A compact strip showing per-section memory band, anchored opening line + closing line if known. (Anchor lines are out of scope as a *typed* concept this round; we just keep the existing per-section bands.)
2. **Coach feedback** — kept (headline + summary).
3. **Manuscript** — unchanged left column. Right column changes.
4. **Right rail** — drill-first, not edit-first:
   - Hide the "Script edits" group entirely if the report has zero substantive script edits (the common case in freestyle).
   - Surface "Drill plan" group — one drill card per weak section, ordered by severity, with a primary CTA per card that drops the user into From-memory recording **scoped to that section**.
   - Observation cards still appear under "Delivery notes" but only for sections that were *not* blanked (blanked observations are noise — already handled by PR #19 for rephrases; we extend to skip observations on blanked sections too).
5. **Bottom: NextStepCard.** Replaces the current sticky-footer "Apply to script only / Drill again" pair. The footer shows the recommendation; "Apply…" is moved into a less-prominent menu since freestyle reports rarely have script-mutating edits.

### 6.3 Recording page (`/app/speeches/[id]/record`)

**Add:** support for `?mode=` and `?section=` query params, prepopulating the recorder's internal state. The record page already accepts `from_session`, `from_v`, and `drilling=1`; this is a parallel addition.

The status banner copy is updated:
- `?mode=freestyle&section={id}` → "Drilling **{section name}** from memory."
- `?mode=freestyle` (no section) → "Recording from memory."
- `?mode=with-script` → no special banner (today's default).

We do **not** otherwise redesign the record page. Section-scoped practice already works; we're piping the choice in via query params instead of forcing the user to find the toggle.

### 6.4 Copy table (final UI strings)

| Phase | Headline | Rationale | Primary CTA |
|---|---|---|---|
| Familiarize (no takes) | "Read it aloud first." | "We'll tell you what lands and what to tighten." | "Record with script visible" |
| Familiarize (after edit) | "Try the new version." | "You changed the script — run it again so we can hear how it lands." | "Record with script visible" |
| Tighten | "Try those edits live." | "Apply the suggestions you like, then record again." | "Apply edits & record" |
| Lock → memorize | "Time to memorize." | "The writing's in good shape. Drill {first section} from memory next." | "Drill {first section} from memory" |
| Memorize: section | "Drill {section} again." | "{Section} is where memory's slipping." | "Drill {section} from memory" |
| Memorize: cumulative | "Run the whole thing." | "Each section's holding — try it end to end." | "Record from memory" |
| Polish | "Run it cold." | "No warm-up. That's the rep that matches game day." | "Record from memory" |
| Done | "You've got it." | "Over-rehearsing now hurts more than it helps. Light run tomorrow if you want." | "Light run from memory" |

(Headlines are deliberately under ~30 chars; rationale under ~80.)

### 6.5 Visual design

The NextStepCard reuses existing tokens:
- Card background: `var(--color-canvas-white)` with the existing `card-elevated` shape.
- Headline: `text-heading` (smaller than page H1).
- Rationale: `text-body` muted.
- Primary CTA: `btn-primary`.
- Secondary menu: `btn-light` with a small caret.

No new CSS variables, no new color choices. We piggyback on the existing design system.

---

## 7. Data flow & implementation surfaces

### 7.1 New files

- `web/src/lib/lifecycle.ts` — pure recommendation logic.
  - `recommendNext(input: RecommendationInput): Recommendation`
  - `gatherSpeechSignals(supabase, speechId): Promise<RecommendationInput>` — server-side helper that pulls the necessary rows. Lives here to keep the page files thin.
  - Exports `RecommendationPhase`, `Recommendation`, etc.
- `web/src/components/next-step-card.tsx` — the reusable card. Server component; accepts a `Recommendation` prop and renders.
- `web/src/components/next-step-card.module.css` — *not* this; we're reusing existing classes. (Note: project doesn't use CSS modules — we use Tailwind + global classes.)

### 7.2 Modified files

- `web/src/app/app/(shell)/speeches/[id]/page.tsx` — integrate NextStepCard above the script preview.
- `web/src/app/app/(shell)/speeches/[id]/sessions/[sid]/page.tsx` — add NextStepCard at bottom; redesign rail when freestyle.
- `web/src/app/app/(shell)/speeches/[id]/sessions/[sid]/manuscript-script.tsx` — accept new `viewMode` defaults / new "drill plan" rail group; suppress observation cards on blanked sections; conditionally hide "Script edits" group when empty in freestyle.
- `web/src/app/app/(shell)/speeches/[id]/record/page.tsx` — read `mode` and `section` query params, propagate to Recorder.
- `web/src/app/app/(shell)/speeches/[id]/record/recorder.tsx` — accept `initialMode` and `initialSectionId` props.
- `web/src/lib/ai-coach.ts` — prompt v5: more aggressive memorization-aware drill emission. Specifically: in freestyle mode, emit one drill per blanked or rough section by default. Tighten the existing rephrase rules a notch further.
- `web/src/lib/modes.ts` — add helper for "should the report show script-edit framing?" → already handled by content checks, but a comment update.

### 7.3 No schema changes

We considered adding:
- `speeches.event_date` — declined this PR (out of scope; recommendation engine handles `null`).
- `sessions.section_focus` — declined; section scoping passed via query param to recording, deduced for reports from existing data.

Result: zero migrations.

### 7.4 Auto-classification of existing data

Per the user's direction, existing speeches/sessions are auto-classified by feeding them through the recommendation engine on next page load. Because we derive everything, the only thing a returning user might experience is a different recommended next action — the underlying data is identical. No background job required.

---

## 8. Coach prompt v5

The coach prompt is bumped to v5 with three changes:

1. **Drill-per-weak-section default in freestyle.** Today the prompt says "default suggestion bias: drill > rephrase > adopt > cut." We tighten this: in freestyle mode, *every* section that the user blanked or struggled with should get its own drill suggestion (capped at 5 total edits). The drill `tactic` field is required.
2. **Tactic vocabulary.** We give the model a small vocabulary of evidence-backed tactics:
   - "Cumulative drill" — practice this section, then this+next together.
   - "Bridge drill" — practice the last sentence of the previous section into the first sentence of this one.
   - "Anchor drill" — drill the first sentence cold, 5 times.
   - "Read-aloud encoding" — read this section aloud 2x, with intent, before drilling.
   - "First-letter check" — practice with first letters only.
   - "Cold start run" — open the app, deliver immediately, no warm-up. Use sparingly.
3. **Mode-appropriate observation phrasing.** In freestyle, observations describe *recall*, not *delivery*. "You blanked here," not "you said it differently." The phrase "you said it differently than you wrote it" is forbidden in freestyle mode entirely.

### 8.1 New prompt rule (paraphrased for this PRD; full text in `ai-coach.ts`)

> In freestyle mode, **every section with a memory band of "blank" or "rough" must receive a drill suggestion** (subject to the 5-edit cap; pick the most severe). Blanked sections should *not* receive observation prose like "you skipped this" alone — they receive a drill with tactic `"Read-aloud encoding"`. Rough sections receive `"Cumulative drill"` or `"Bridge drill"` based on which transitions failed.
>
> Reframe paraphrasing as *retention of meaning* in this mode. "You said {paraphrased} instead of {script}, but you got the meaning — once more cleanly" is acceptable; "You said it differently than you wrote it" is not.

PROMPT_VERSION → 5.

---

## 9. Edge cases

| Case | Handling |
|---|---|
| User uploads a speech, opens detail page before recording | Familiarize phase. Recommendation = "Read it aloud first." |
| User records once, opens detail page, no edits surfaced | Tighten phase, but with rationale "Run it again — see what you tighten the second time." |
| User recorded a session against an *old* version, then edited the script | Familiarize phase, forced. Old session's data feeds the report but not the recommendation. |
| Coach output is missing/null | Recommendation falls back to the no-coach path: still surfaces, but rationale acknowledges "Coach feedback is still landing" and CTA is "Record again." |
| User on free plan with 0 sessions remaining | NextStepCard renders, primary action shows the upgrade flow rather than the recommended action; copy says "Upgrade to keep going." |
| User has only one section in the speech | Memorize phase still applies, but cumulative-drill collapses to "drill this one section" — no bridges to drill. |
| Speech has zero sections | Recommendation = "Add some sections to your script first." → links to /edit. |
| The recommendation engine throws | Wrap in try/catch; on error, render no card and log. The page still works. |

---

## 10. Telemetry (deferred but designed for)

We don't add telemetry hooks in this PR (no analytics surface today on this codebase as far as the audit found), but the recommendation engine emits `signals: string[]` on the result type so we can hook it up cheaply later. Useful events to capture eventually:

- `recommendation_shown` { phase, signals }
- `recommendation_accepted` { phase, primaryAction.label }
- `recommendation_overridden` { phase, what_user_chose }

We tag the right `data-recommendation-phase` attribute on the NextStepCard so a future analytics pass can grep for it.

---

## 11. Open questions / risks

1. **Coach output stability.** The recommendation engine assumes coach output is reasonable. Bad coach output (e.g. flagging blanked sections as `rephrase`) was an active bug as of last conversation; PR #19 fixed it; the v5 prompt tightens it further. If the coach goes off-script in unexpected ways, the recommendation might be misleading. Mitigation: filter rephrase suggestions defensively in `lifecycle.ts` before they're surfaced.
2. **"Lock the script" recommendation triggers too aggressively.** If the user records once and the coach proposes no edits, are we sure they're ready to memorize? Probably no — bumping the threshold to ≥2 Script-visible takes is a lower-regret choice. We may need to bump higher after dogfooding.
3. **Cold start framing.** We tell the user "no warm-up." If they ignore that and warm up anyway, the rec is harmless — it doesn't gate anything. But the framing matters; copy needs review.
4. **First section name as the recommended drill target.** Today we'd say "Drill {section_name} from memory." If the user named their sections weirdly ("untitled section 2"), the copy reads badly. We fall back to "Drill the first section" if section names are missing/empty.
5. **No event-date input means no time pressure.** The recommendation engine can't tell a user they're 1 day from the wedding. Once event date capture lands, we add a `daysUntilEvent` arm to the algorithm.

---

## 12. Implementation plan (commits, in order)

1. **Add PRD + research docs to repo.** `docs/lifecycle-coaching-prd.md` (this file), `docs/memorization-research.md`. Single commit.
2. **Add `lib/lifecycle.ts`** — pure functions only, no UI. Includes `recommendNext`, `gatherSpeechSignals`, types. Single commit.
3. **Add `components/next-step-card.tsx`** — server component, takes a `Recommendation`, renders the card. Single commit.
4. **Wire NextStepCard into speech detail page.** Single commit; no other behavior changes.
5. **Wire NextStepCard into session report page.** Single commit; works for both modes (with-script: bottom; freestyle: bottom replacing the action bar).
6. **Pipe `mode` and `section` query params into recording flow.** Adjust record page + recorder. Single commit.
7. **Restructure From-memory rail.** Hide Script-edits group when empty; suppress observation cards on blanked sections. Single commit.
8. **Coach prompt v5.** Bump prompt version, add tactic vocabulary, freestyle drill-per-weak-section rule. Single commit.
9. **Manual + automated test pass.** Lint, typecheck, walk the four scenarios. Last commit (if changes needed) or just the PR description.

Each commit compiles and passes typecheck independently. PR description summarizes the rollup; reviewers can read commit-by-commit.

---

## 13. Definition of done

- [ ] PRD + research committed to repo and saved as Artyfact
- [ ] `lib/lifecycle.ts` exists with `recommendNext` covering all branches in §5.3
- [ ] NextStepCard component renders on speech detail and session report pages
- [ ] Recording page accepts `mode` and `section` query params and propagates them
- [ ] Freestyle session report hides Script-edits group when empty; observations suppressed on blanked sections
- [ ] Coach prompt is at v5 with the new drill rules
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm lint` passes on changed files (existing pre-existing warnings ignored)
- [ ] Manual walk-through confirms each scenario produces a sensible recommendation:
  - Brand-new speech → Familiarize
  - One Script-visible take → Tighten or Lock (depending on coach output)
  - Two Script-visible takes with no new edits → Lock → memorize, scoped to first section
  - Freestyle take with one blanked section → Memorize: section, scoped to that section
  - Freestyle take all-mostly-there → Memorize: cumulative
- [ ] PR opened against `main` with this PRD linked from the description.
