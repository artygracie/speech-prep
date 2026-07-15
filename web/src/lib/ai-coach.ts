// Server-only AI coach: produces an ai_reports row for a session.
//
// This is THE coach — the former edge `coach` function's audio-signal
// computation (prompt v2 / edge v7) was folded in here for prompt v6,
// and the edge function is retired. One implementation, one prompt.
//
// Inputs (caller assembles these):
//   - the session mode (with-script | freestyle) — drives the coaching
//     persona (writing coach vs. memorization coach)
//   - the speech's sections (id, name, body, target_seconds)
//   - the transcript (text + words[] with timings)
//   - per-section metrics from alignment.ts (actual_seconds, delta,
//     wpm, filler_count, pause_ms_total, word range) — these tell the
//     coach what was rushed, dragged, or skipped without making the
//     model do arithmetic
//   - the session's diff rows (from buildDiff/coalesceDiff) summarised
//     down to counts so the coach knows what's already been promoted
//   - live tags the speaker self-flagged while recording
//
// From the word timings we derive per-section DELIVERY signals
// deterministically (no extra API spend): pause distribution
// (>0.5s/>1s/>2s), longest pause + timestamp, WPM variance ratio per
// ~10s window, filler timestamps, and section transition gaps.
//
// Output: { headline, summary, per_section[], suggested_edits[] }
//   - headline is a one-sentence pull-quote (≤90 chars) — the most
//     important takeaway, rendered as a hero pull-quote on the report
//   - suggested_edits include kind: "drill" (with optional tactic) for
//     practice-action suggestions; the dominant kind in freestyle mode
//
// Model: claude-sonnet-4-6, with prompt caching on the static system
// prompt + style guide so the per-call cost stays reasonable.
//
// If ANTHROPIC_API_KEY is unset, the coach returns null and the caller
// just doesn't write a report — the session still has a deterministic
// paraphrase-promotion fallback to fill the suggested_edits slot.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { isFillerWord, type TranscriptWord } from "./alignment";
import type { SessionMode } from "./modes";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
let _missingKeyWarned = false;
function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    if (!_missingKeyWarned) {
      _missingKeyWarned = true;
      console.error("[ai-coach] ANTHROPIC_API_KEY is not set — coach reports will not generate");
    }
    return null;
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export type CoachSection = {
  id: string;
  name: string;
  body: string;
  targetSeconds: number;
};

export type CoachMetric = {
  sectionId: string;
  actualSeconds: number;
  deltaSeconds: number;
  wpm: number | null;
  fillerCount: number;
  // Sum of >500ms inter-word gaps within the section (alignment.ts).
  pauseMsTotal: number;
  // Word range into the transcript words[] — drives the per-section
  // audio-signal derivation. Null when no words aligned to the section.
  wordStartIdx: number | null;
  wordEndIdx: number | null;
};

// A moment the speaker self-flagged live (keyboard tags in the
// recorder): landed / flat / lost place / callback, with a timestamp.
export type CoachLiveTag = { kind: string; label: string; atMs: number };

export type CoachInput = {
  mode: SessionMode;
  speechTitle: string;
  occasion: string | null;
  sections: CoachSection[];
  metrics: CoachMetric[];
  transcriptText: string;
  // Word-level timings — used to derive delivery signals and to verify
  // the transcript actually made it into the prompt.
  words: TranscriptWord[];
  tags: CoachLiveTag[];
  diffCounts: {
    matched: number;
    paraphrased: number;
    skipped: number;
    improvised: number;
  };
};

export type SuggestedEditKind = "cut" | "adopt" | "rephrase" | "drill";
export type SuggestedEditProvenance = "coach" | "user-flag" | "alignment";

export type CoachReport = {
  headline: string;
  summary: string;
  per_section: Array<{
    section_id: string;
    headline: string;
    what_landed: string;
    what_to_work_on: string;
    severity: "low" | "med" | "high";
  }>;
  suggested_edits: Array<{
    id: string;
    kind: SuggestedEditKind;
    section_id: string;
    // For "cut" / "rephrase": the verbatim script substring to operate on.
    // For "adopt": the script line that ANCHORS the new insertion — the
    //   apply path inserts `insertion` immediately after `before` in
    //   the body. (Required for adopt as of prompt v3.)
    before?: string;
    // For "rephrase": the new text to swap in.
    // For "adopt" pre-v3 reports: may contain the full revised passage
    //   (legacy). We extract the actual insertion at apply time.
    after?: string;
    // For "adopt" v3+: ONLY the new text being inserted, not the full
    // revised passage. Lets the apply path do a clean targeted insert
    // instead of a brittle tail-append.
    insertion?: string;
    reason: string;
    // Practice-action fields, used when kind === "drill"
    line_target?: string;
    tactic?: string;
    // Provenance — coach-generated edits always carry "coach"; the
    // paraphrase promoter and live-tag derivers tag their own.
    provenance?: SuggestedEditProvenance;
  }>;
  // Token accounting — written to ai_reports for cost tracking.
  input_tokens: number;
  output_tokens: number;
  prompt_version: number;
};

// ============================================================
// Audio signals — derived deterministically from word timings.
// Ported from the retired edge `coach` function (v7) so the unified
// coach keeps its delivery-level insight.
// ============================================================

export type AudioSignal = {
  sectionId: string;
  sectionName: string;
  // Pause buckets: count of inter-word gaps in each band. Excludes the
  // gap before the section's first word.
  pauses500ms: number;
  pauses1s: number;
  pauses2s: number;
  // Longest single pause within the section, and when it happened
  // (wall-clock ms from session start).
  longestPauseMs: number;
  longestPauseAtMs: number;
  // WPM computed across each ~10s window in the section, summarised as
  // stdev / mean. Higher = choppier. Null when the section is too
  // short to windowise meaningfully.
  wpmVarianceRatio: number | null;
  // Filler-word timestamps (first 5).
  fillerExamples: { word: string; atMs: number }[];
  // Gap between this section's last word and the next section's first
  // word. -1 when this is the last section or the next has no words.
  transitionGapMs: number;
};

function computeAudioSignals(
  sections: CoachSection[],
  metrics: CoachMetric[],
  words: TranscriptWord[],
): AudioSignal[] {
  const out: AudioSignal[] = [];
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const m = metrics.find((x) => x.sectionId === sec.id);
    if (!m || m.wordStartIdx == null || m.wordEndIdx == null) {
      // No timing for this section — emit a stub so per-section
      // ordering stays aligned in the prompt.
      out.push({
        sectionId: sec.id,
        sectionName: sec.name,
        pauses500ms: 0,
        pauses1s: 0,
        pauses2s: 0,
        longestPauseMs: 0,
        longestPauseAtMs: 0,
        wpmVarianceRatio: null,
        fillerExamples: [],
        transitionGapMs: -1,
      });
      continue;
    }

    const start = m.wordStartIdx;
    const end = Math.min(words.length - 1, m.wordEndIdx);
    const slice = words.slice(start, end + 1);

    // ---------- Pause distribution ----------
    let p500 = 0, p1k = 0, p2k = 0;
    let longestMs = 0;
    let longestAt = 0;
    for (let i = 1; i < slice.length; i++) {
      const gap = slice[i].startMs - slice[i - 1].endMs;
      if (gap >= 500) p500++;
      if (gap >= 1000) p1k++;
      if (gap >= 2000) p2k++;
      if (gap > longestMs) {
        longestMs = gap;
        longestAt = slice[i - 1].endMs;
      }
    }

    // ---------- WPM variance per ~10s window ----------
    const sectionStartMs = slice[0]?.startMs ?? 0;
    const sectionEndMs = slice[slice.length - 1]?.endMs ?? sectionStartMs;
    const dur = sectionEndMs - sectionStartMs;
    let wpmVar: number | null = null;
    if (dur >= 5000 && slice.length >= 8) {
      const windows: number[] = [];
      const winSize = 10_000;
      for (let t = sectionStartMs; t < sectionEndMs; t += winSize) {
        const winEnd = Math.min(sectionEndMs, t + winSize);
        const winWords = slice.filter((w) => w.startMs >= t && w.startMs < winEnd).length;
        const winSec = (winEnd - t) / 1000;
        if (winSec >= 3) windows.push((winWords / winSec) * 60);
      }
      if (windows.length >= 2) {
        const mean = windows.reduce((a, b) => a + b, 0) / windows.length;
        if (mean > 0) {
          const variance =
            windows.reduce((a, b) => a + (b - mean) ** 2, 0) / windows.length;
          const stdev = Math.sqrt(variance);
          wpmVar = +(stdev / mean).toFixed(2);
        }
      }
    }

    // ---------- Filler examples ----------
    const fillerExamples: { word: string; atMs: number }[] = [];
    for (const w of slice) {
      if (fillerExamples.length >= 5) break;
      if (w.isFiller === true || isFillerWord(w.word)) {
        fillerExamples.push({ word: w.word, atMs: w.startMs });
      }
    }

    // ---------- Transition gap ----------
    let transitionGap = -1;
    if (si < sections.length - 1) {
      const nextSec = sections[si + 1];
      const nextM = metrics.find((x) => x.sectionId === nextSec.id);
      if (nextM?.wordStartIdx != null && words[nextM.wordStartIdx]) {
        const lastEnd = slice[slice.length - 1]?.endMs ?? 0;
        transitionGap = Math.max(0, words[nextM.wordStartIdx].startMs - lastEnd);
      }
    }

    out.push({
      sectionId: sec.id,
      sectionName: sec.name,
      pauses500ms: p500,
      pauses1s: p1k,
      pauses2s: p2k,
      longestPauseMs: longestMs,
      longestPauseAtMs: longestAt,
      wpmVarianceRatio: wpmVar,
      fillerExamples,
      transitionGapMs: transitionGap,
    });
  }
  return out;
}

// Bump this when the SYSTEM_PROMPT or persona blocks change.
// ai_reports.prompt_version uses a numeric column so we can range-query
// or chart by version.
//
// v6 — unified coach: merged the edge coach's audio-derived delivery
// signals (pauses, WPM variance, filler timestamps, transition gaps,
// live tags) into the v5 persona/drill prompt, plus the no-audio
// validation gate in generateCoachReport.
const PROMPT_VERSION = 6;

// Static system prompt — cached. The dynamic per-session content goes
// in the user message so the cache hits on every call.
//
// Two coaching personas live in this file. The system prompt teaches
// the model BOTH personas; the user message tells it which one to use
// for this call. Same output schema either way.
const SYSTEM_PROMPT = `You are a speech coach. You are reading a single rehearsal take from one of two perspectives — the user's mode tells you which:

WRITING COACH (mode: "with-script")
The speaker had the script in front of them. Your lens: "does this writing land out loud?"
Treat deviations from the script as data about the writing, not the speaker's discipline.
- When the speaker naturally improvised a line that's better than the script (more honest, more rhythmic, more natural), call it out. Quote both versions and recommend adopting the spoken version. This is the most valuable thing you can do — it turns rehearsal into editing.
- When the speaker repeatedly stumbled, paraphrased, or skipped a line, that line is probably awkward. Recommend rewriting (kind: "rephrase"), not rehearsing — unless the line is clearly fine and the issue is delivery (then say so, kind: "drill" sparingly).
- Default suggestion bias: adopt > rephrase > drill > cut.

MEMORIZATION COACH (mode: "freestyle")
The speaker delivered from memory. The script was hidden. Your lens: "where did memory hold and where did it fail?"
Treat deviations from the script as gaps in memorization. The user is trying to MATCH the script, not improve it.
- Identify which sections were word-perfect, which were paraphrased (memory approximate), which were skipped or blanked.
- EVERY section the speaker blanked on or struggled to recall MUST receive a drill suggestion (subject to the 5-edit cap; pick the most severe sections first). The drill's "tactic" field is REQUIRED in freestyle mode.
- DO NOT propose "rephrase" suggestions for sections the speaker blanked on or struggled to recall. A blanked section means the script wasn't memorised — not that the writing is bad. Use drill.
- "rephrase" is ONLY valid in freestyle mode when (a) the section was mostly recalled AND (b) a specific written line is genuinely awkward to memorise (long, abstract, syntactically tangled) AND (c) you can name the wording change that would fix it. If any of those three is missing, use drill instead.
- Do NOT scold paraphrasing. The speaker did not improvise on purpose; their memory filled a gap. Frame as "the line you reached for," not "your improvement on the script."
- The phrase "you said it differently than you wrote it" is FORBIDDEN in freestyle mode. In this mode, the question is recall, not delivery. Phrasings like "you blanked," "you reached for," "the line slipped" are correct; "you said it differently" implies the speaker chose to deviate.
- Default suggestion bias: drill > rephrase > adopt > cut. Most freestyle reports should have ZERO rephrases.

DRILL TACTIC VOCABULARY (freestyle)
When emitting a drill in freestyle mode, prefer these evidence-backed tactics. The "tactic" field should be one short sentence that names the technique.
- "Cumulative drill" — practice this section, then this+next, then this+next+next. Use when bridges between sections are weak.
- "Bridge drill" — practice the last sentence of the previous section running into the first sentence of this one. Use when transitions in particular failed.
- "Anchor drill" — drill the first sentence cold, 5 times. Use for opening sections or sections whose first line is the cue for the rest.
- "Read-aloud encoding" — read this section aloud 2x, with intent, before drilling. Use for blanked sections — the user needs to re-encode before they can drill.
- "First-letter check" — practice the section reading only the first letter of each word. Use when the section is mostly there but a few words are stubbornly missing.
- "Cold start run" — open the app and deliver the section immediately, no warm-up. Use sparingly, mostly for sections that are word-perfect when warmed up but fragile cold.

DELIVERY SIGNALS (both modes)
The user message includes per-section audio signals derived deterministically from word timings: pause distribution (counts of >0.5s / >1s / >2s gaps), the longest pause and when it happened, a WPM variance ratio per ~10s window, filler-word timestamps, and the silence gap into the next section. Use them to give DELIVERY feedback, not just text feedback:
- Long pauses inside a section (>2s) often signal the speaker losing their place.
- A pause >2s right before a punchline or callback can be intentional and effective — don't flag it as a problem if it preceded a strong line.
- A high WPM variance ratio (>0.35) means the section was choppy. Worth flagging if it correlates with skipped lines or fillers.
- A flat WPM variance ratio (<0.10) over a long section can mean monotone delivery.
- Multiple fillers ("um", "uh") in one section, especially at consistent positions, suggest a phrase the speaker stumbles on every time. In with-script mode, propose a rephrase that flows better; in freestyle mode that's a recall gap — drill it.
- Transition gaps >3s between sections suggest the speaker isn't sure how to bridge. In with-script mode that may mean a missing connective sentence in the script; in freestyle mode, use a bridge drill.
- The speaker may also have self-flagged moments live (landed / flat / lost place / callback) with timestamps — treat these as ground truth for how the take felt from the inside, and anchor feedback to them when they line up with a signal.

In BOTH modes, you also produce:

1. A one-sentence HEADLINE (≤90 chars) — the single most important takeaway. Specific, never generic.
   Bad: "Work on your pacing."
   Good: "You rushed the opener — slow your first 30 seconds by 2 beats."
   Reference a concrete moment, line, or section by name when you can. Imperative or observational, never advisory ("try to", "consider").

2. A two-sentence summary — what worked, what to work on next.

3. Per-section notes — for each section: one short headline, one line on what landed, one line on what to work on. Severity is "high" if the section was skipped or rushed >30%, "med" if it ran long or had fillers, "low" otherwise.

4. Suggested edits — at most 5, ordered by impact. Schema:
   - kind: "cut"      → remove a written passage. Set "before" to the verbatim script substring to remove.
   - kind: "adopt"    → INSERT a new phrase into the script at a specific anchor.
                        Set "before" to a verbatim script sentence that already exists in the body — this is the ANCHOR. The new phrase will be inserted immediately AFTER "before" in the script.
                        Set "insertion" to ONLY the new words being added — do NOT include the existing script text. Example: if "before" is "but here we are." and you want the script to read "but here we are. Are you really sure? You've heard me in meetings.", set "insertion" to "Are you really sure? You've heard me in meetings."
                        Do NOT put the full revised paragraph in "insertion". Just the new words.
   - kind: "rephrase" → swap a written passage for new wording. Set "before" to the verbatim script substring being replaced, "after" to the replacement text. STRICT criteria below — most "speaker said it differently" moments are NOT rephrases.
   - kind: "drill"    → no script change. Target a section/line and tell the user how to practice it. Set "line_target" (a quoted snippet from the script, optional) and "tactic" (one sentence on the practice approach, optional).

WHEN TO PROPOSE A REPHRASE — strict definition:
A rephrase is only valid when you genuinely believe the new wording is BETTER than what's written, and you can name why in one specific phrase ("tighter rhythm", "drops a word the speaker stumbled on", "lands the punchline cleaner", etc.). The "after" must be a polished line you would put into a final draft.

A rephrase is NOT:
- "the speaker said it differently" (that's an observation, not an edit)
- "the speaker forgot a word" (that's a memory or delivery issue — drill, don't rewrite)
- a Frankenstein reconstruction of the transcript with words missing (those are blanks, not improvements)
- any case where the spoken version is grammatically broken, unclear, or worse than what's written

If you can't write a "reason" that names a specific QUALITY win the new wording delivers, do not emit a rephrase. Use drill or omit the suggestion entirely.

Reason field for rephrase MUST start with the quality win in plain language. Examples:
- "Tighter — drops 'genuine' which adds nothing."
- "Lands the punchline cleaner; the rhetorical question carries it."
- "Cuts a stumble word the speaker tripped on twice."
Bad: "You said this differently than you wrote it." (vague — not a reason)
Bad: "Matches what you said." (not a quality claim)

Voice: direct, specific, encouraging. Don't lecture about public speaking in general; only react to this take. No therapy speak. No "great job" without specifics.

Output STRICT JSON, no prose, no markdown:
{
  "headline": "...",
  "summary": "...",
  "per_section": [{"section_id": "...", "headline": "...", "what_landed": "...", "what_to_work_on": "...", "severity": "low|med|high"}],
  "suggested_edits": [{"id": "edit-1", "kind": "cut|adopt|rephrase|drill", "section_id": "...", "before": "...", "after": "...", "insertion": "...", "line_target": "...", "tactic": "...", "reason": "..."}]
}

Hard rules:
- "before" for "cut", "rephrase", and "adopt" MUST be a verbatim substring of the section body. If you can't quote verbatim, omit the suggestion.
- "after" for "rephrase" is the replacement text.
- "insertion" for "adopt" is ONLY the new words to add — never the full revised paragraph. The "insertion" text MUST NOT already appear in the script body.
- For "drill", omit before/after/insertion; include tactic.
- Section ids are opaque — copy unchanged from input.
- Edit ids are opaque strings you choose, like "edit-1". Unique within the response.
- headline ≤ 90 characters. If you can't fit, prefer specificity over completeness.`;

// Persona-specific guidance prepended to the user message. The
// persona block lives in the user message (not system) because it's
// per-call, but small enough that we don't worry about cache impact.
function personaPrefix(mode: SessionMode): string {
  if (mode === "with-script") {
    return `MODE: with-script (writing coach perspective)

The speaker had the script visible while delivering. Read this take as a TEST OF THE WRITING — where does the script land in the mouth, where does it not? Improvisations and natural paraphrasings are GIFTS — surface them as adopt/rephrase suggestions. Don't suggest drilling unless the line is genuinely good and the speaker just needs reps.

`;
  }
  // freestyle
  return `MODE: freestyle (memorization coach perspective)

The speaker delivered from memory — the script was HIDDEN. Read this take as a MEMORY CHECK — which sections held, which did not? Default to drill suggestions for weak sections. Do not celebrate paraphrasing as "better phrasing" — these are memory gaps, not editorial improvements.

Every section the speaker blanked on or struggled with should get its own drill suggestion (up to the 5-edit cap). Pick a tactic from the drill vocabulary in the system prompt. Drills MUST have a tactic field.

Rephrases are RARE in this mode. A blanked or rough section means the script wasn't memorised — that's a recall problem, not a writing problem. The fix is drill, not rewrite. Only emit a rephrase if the section was mostly recalled AND a specific line is genuinely hard to memorise AND you can name the wording change that would fix it. When in doubt, use drill or omit.

`;
}

// Truncate a headline to ≤ maxChars at a word boundary if possible.
// Models occasionally overshoot the 90-char limit; we don't want a
// grammatically broken cliffhanger in production.
function clampHeadline(s: string, maxChars = 90): string {
  const trimmed = s.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.6) return slice.slice(0, lastSpace).trim();
  return slice.trim();
}

// ============================================================
// No-audio validation gate.
//
// ROOT CAUSE of the historical "no audio was recorded" reports (~20%
// of all reports ever generated, 15 of them over transcripts >300
// chars): those sessions were recorded against script versions whose
// only section had an EMPTY body. With zero script tokens the aligner
// returns no pairs, so section_metrics landed as "0s actual, no word
// range" and the alignment diff was empty. The retired edge coach's
// prompt carried ONLY the diff and metrics — never the raw transcript
// — so the model was literally told "actual 0s … (no transcript)" and
// reasonably concluded nothing was recorded, while a full transcript
// sat in the DB.
//
// Two defences now:
//   1. buildUserMessage ALWAYS embeds the raw transcript text (and we
//      reconstruct it from words[] if the text column is empty).
//   2. This gate rejects any generated report that still claims
//      silence over a non-empty transcript, regenerates once with a
//      corrective note, and refuses to return fiction if that fails.
// ============================================================

const NO_AUDIO_CLAIM =
  /\bno audio\b|\bno speech\b|\bnothing (?:was )?recorded\b|\btranscript is (?:completely |entirely )?(?:empty|blank)\b|\bempty transcript\b|\bfailed to (?:capture|record)\b|\bcame (?:in|up|back) (?:blank|empty)\b/i;

function claimsNoAudio(report: CoachReport): boolean {
  return NO_AUDIO_CLAIM.test(`${report.headline} ${report.summary}`);
}

export async function generateCoachReport(
  input: CoachInput,
): Promise<CoachReport | null> {
  const c = client();
  if (!c) return null;

  // Input hardening: if the transcript has words, the prompt MUST
  // carry them. The text column is the preferred surface; fall back to
  // joining the timed words so a blank text column can never produce a
  // silent prompt over a non-silent take.
  const transcriptText =
    input.transcriptText.trim().length > 0
      ? input.transcriptText
      : input.words.map((w) => w.word).join(" ");
  const hasSpeech = transcriptText.trim().length > 0;
  const hardened: CoachInput = { ...input, transcriptText };

  const userMessage = personaPrefix(input.mode) + buildUserMessage(hardened);

  const first = await callCoachModel(c, userMessage);
  if (!first) return null;
  if (!hasSpeech || !claimsNoAudio(first)) return first;

  // The model claimed silence over a non-empty transcript. Regenerate
  // once with an explicit reality check appended to the input.
  console.error("[ai-coach] report claimed no audio over a non-empty transcript — regenerating", {
    words: input.words.length,
    transcriptChars: transcriptText.length,
    headline: first.headline,
  });
  const retry = await callCoachModel(
    c,
    `${userMessage}

REALITY CHECK: audio WAS recorded and transcribed for this session — the transcript above contains ${input.words.length} timed words. Do NOT claim that no audio was recorded or that the transcript is empty. If the script sections are blank, coach the delivery you can hear in the transcript and suggest the speaker write the script down.`,
  );
  if (retry && !claimsNoAudio(retry)) return retry;

  console.error(
    "[ai-coach] regenerated report still claims no audio — rejecting rather than storing fiction",
    { words: input.words.length },
  );
  return null;
}

// One model round-trip: call, parse, validate shape, clamp headline.
async function callCoachModel(
  c: Anthropic,
  userMessage: string,
): Promise<CoachReport | null> {
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Prompt cache the static system prompt — the dynamic
          // user message changes per call, so this is the only
          // breakpoint worth caching.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });

    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = parseJson(block.text) as Partial<CoachReport> | null;
    if (!parsed || typeof parsed.summary !== "string") return null;

    const perSection = Array.isArray(parsed.per_section)
      ? parsed.per_section.filter(isPerSectionRow)
      : [];
    const editsRaw = Array.isArray(parsed.suggested_edits)
      ? parsed.suggested_edits.filter(isSuggestedEdit)
      : [];
    // Stamp every coach-originated edit with provenance "coach". The
    // paraphrase promoter and user-flag derivers stamp their own.
    const edits = editsRaw.map((e) => ({ ...e, provenance: "coach" as const }));

    // Headline: required for v2 reports, but if the model omits it or
    // returns junk, fall back to the first sentence of the summary so
    // the UI never has to deal with an empty hero block.
    const rawHeadline = typeof parsed.headline === "string" ? parsed.headline : "";
    const headline = rawHeadline
      ? clampHeadline(rawHeadline)
      : firstSentence(parsed.summary);
    if (rawHeadline && rawHeadline.length > 90) {
      console.warn(
        `[ai-coach] headline overflow: ${rawHeadline.length} chars — truncated to ${headline.length}`,
      );
    }

    return {
      headline,
      summary: parsed.summary,
      per_section: perSection,
      suggested_edits: edits,
      input_tokens: res.usage?.input_tokens ?? 0,
      output_tokens: res.usage?.output_tokens ?? 0,
      prompt_version: PROMPT_VERSION,
    };
  } catch (err) {
    console.error("[ai-coach] coach model call failed", err);
    return null;
  }
}

function fmtSignal(s: AudioSignal): string {
  const fillers = s.fillerExamples.length
    ? s.fillerExamples
        .map((f) => `"${f.word}" @ ${(f.atMs / 1000).toFixed(1)}s`)
        .join(", ")
    : "none";
  const variance =
    s.wpmVarianceRatio == null
      ? "n/a (section too short)"
      : s.wpmVarianceRatio.toFixed(2);
  const transition =
    s.transitionGapMs < 0
      ? "(last section)"
      : `${(s.transitionGapMs / 1000).toFixed(1)}s to next`;
  return (
    `[${s.sectionId}] ${s.sectionName}:\n` +
    `  pauses: ${s.pauses500ms} >0.5s, ${s.pauses1s} >1s, ${s.pauses2s} >2s\n` +
    `  longest pause: ${(s.longestPauseMs / 1000).toFixed(1)}s @ ${(s.longestPauseAtMs / 1000).toFixed(1)}s\n` +
    `  wpm variance ratio: ${variance}\n` +
    `  filler instances: ${fillers}\n` +
    `  transition: ${transition}`
  );
}

function buildUserMessage(input: CoachInput): string {
  const sections = input.sections
    .map(
      (s) =>
        `[${s.id}] ${s.name} (target ${s.targetSeconds}s)\n${s.body.trim()}`,
    )
    .join("\n\n---\n\n");

  const metrics = input.metrics
    .map((m) => {
      const sec =
        input.sections.find((s) => s.id === m.sectionId)?.name ?? m.sectionId;
      return `[${m.sectionId}] ${sec}: actual ${m.actualSeconds}s, delta ${m.deltaSeconds >= 0 ? "+" : ""}${m.deltaSeconds}s, wpm ${m.wpm ?? "n/a"}, fillers ${m.fillerCount}, paused ${(m.pauseMsTotal / 1000).toFixed(1)}s total`;
    })
    .join("\n");

  const signals = computeAudioSignals(input.sections, input.metrics, input.words)
    .map(fmtSignal)
    .join("\n\n");

  const tags = input.tags.length
    ? input.tags
        .map((t) => `${t.label || t.kind} at ${(t.atMs / 1000).toFixed(1)}s`)
        .join("; ")
    : "none";

  const counts = input.diffCounts;
  return `Speech: ${input.speechTitle}${input.occasion ? ` (${input.occasion})` : ""}

SECTIONS:
${sections}

PER-SECTION METRICS:
${metrics}

DELIVERY SIGNALS (from word timings):
${signals || "(no signal data)"}

LIVE NOTES (self-flagged while recording): ${tags}

DIFF COUNTS:
matched=${counts.matched} paraphrased=${counts.paraphrased} skipped=${counts.skipped} improvised=${counts.improvised}

TRANSCRIPT (what they actually said):
${input.transcriptText.trim()}`;
}

function firstSentence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^[^.!?]+[.!?]/);
  return clampHeadline(m ? m[0] : trimmed);
}

function isPerSectionRow(x: unknown): x is CoachReport["per_section"][number] {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.section_id === "string" &&
    typeof r.headline === "string" &&
    typeof r.what_landed === "string" &&
    typeof r.what_to_work_on === "string" &&
    (r.severity === "low" || r.severity === "med" || r.severity === "high")
  );
}

function isSuggestedEdit(
  x: unknown,
): x is CoachReport["suggested_edits"][number] {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== "string") return false;
  if (typeof r.section_id !== "string") return false;
  if (typeof r.reason !== "string") return false;
  if (
    r.kind !== "cut" &&
    r.kind !== "adopt" &&
    r.kind !== "rephrase" &&
    r.kind !== "drill"
  ) {
    return false;
  }
  return true;
}

function parseJson(s: string): unknown {
  let t = s.trim();
  // Strip markdown code fences if present.
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  try {
    return JSON.parse(t);
  } catch {
    // Fall back: pull the largest {...} block out of the response.
    // Models occasionally prefix prose ("Here's the JSON:") even when
    // told not to, and we don't want one bad turn to blow the whole
    // session away.
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    console.error("[ai-coach] could not parse model response", {
      preview: t.slice(0, 200),
      length: t.length,
    });
    return null;
  }
}
