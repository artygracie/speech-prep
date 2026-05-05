// Server-only AI coach: produces an ai_reports row for a session.
//
// Inputs (caller assembles these):
//   - the speech's sections (id, name, body, target_seconds)
//   - the transcript (text + optional words[] for citation)
//   - per-section metrics from alignment.ts (actual_seconds, delta,
//     wpm, filler_count) — these tell the coach what was rushed,
//     dragged, or skipped without making the model do arithmetic
//   - the session's diff rows (from buildDiff/coalesceDiff) summarised
//     down to counts so the coach knows what's already been promoted
//
// Output: { summary, per_section[], suggested_edits[] } shaped to match
// the existing ai_reports schema and the coach-card.tsx renderer.
//
// Model: claude-sonnet-4-6, with prompt caching on the static system
// prompt + style guide so the per-call cost stays reasonable.
//
// If ANTHROPIC_API_KEY is unset, the coach returns null and the caller
// just doesn't write a report — the session still has a deterministic
// paraphrase-promotion fallback to fill the suggested_edits slot.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";

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
};

export type CoachInput = {
  speechTitle: string;
  occasion: string | null;
  sections: CoachSection[];
  metrics: CoachMetric[];
  transcriptText: string;
  diffCounts: {
    matched: number;
    paraphrased: number;
    skipped: number;
    improvised: number;
  };
};

export type CoachReport = {
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
    kind: "cut" | "adopt" | "rephrase";
    section_id: string;
    before?: string;
    after?: string;
    reason: string;
  }>;
  // Token accounting — written to ai_reports for cost tracking.
  input_tokens: number;
  output_tokens: number;
  prompt_version: number;
};

// Bump this when the SYSTEM_PROMPT changes. ai_reports.prompt_version
// uses a numeric column so we can range-query / chart by version.
const PROMPT_VERSION = 1;

// Static system prompt — cached. The dynamic per-session content goes
// in the user message so the cache hits on every call.
const SYSTEM_PROMPT = `You are a speech coach reviewing a user's rehearsal. They wrote a script and just delivered it; you have the script, the transcript, per-section pacing, and a count of what they paraphrased / skipped / improvised.

Your job, in priority order:
  1. A two-sentence summary of how the take landed overall (what worked, what to work on next).
  2. Per-section notes — for each section, one short headline, one line on what landed, and one line on what to work on. Severity is "high" if the section was skipped or rushed >30%, "med" if it ran long or had fillers, "low" otherwise.
  3. Suggested edits — concrete changes to the script:
     - "cut": remove a written passage that the speaker skipped or that ran the section long
     - "adopt": add a spoken phrase that landed cleaner than what was written
     - "rephrase": swap a written passage for a spoken one
     For each suggested edit, give the exact "before" substring (must appear verbatim in the script) and the "after" text. Be sparing — at most 5 suggestions. Order by impact.

Voice: direct, specific, encouraging. Don't lecture about public speaking in general; only react to this take.

Output STRICT JSON, no prose, no markdown:
{
  "summary": "...",
  "per_section": [{"section_id": "...", "headline": "...", "what_landed": "...", "what_to_work_on": "...", "severity": "low|med|high"}],
  "suggested_edits": [{"id": "edit-1", "kind": "cut|adopt|rephrase", "section_id": "...", "before": "...", "after": "...", "reason": "..."}]
}

Rules:
- "before" for "cut" and "rephrase" MUST be a verbatim substring of the section body. If you can't quote verbatim, omit the suggestion.
- "after" for "rephrase" and "adopt" should be the speaker's actual spoken phrasing where possible.
- Section ids are opaque strings — copy them through unchanged from the input.
- Edit ids are opaque strings you choose, like "edit-1". They must be unique within the response.`;

export async function generateCoachReport(
  input: CoachInput,
): Promise<CoachReport | null> {
  const c = client();
  if (!c) return null;

  const userMessage = buildUserMessage(input);

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
    const edits = Array.isArray(parsed.suggested_edits)
      ? parsed.suggested_edits.filter(isSuggestedEdit)
      : [];

    return {
      summary: parsed.summary,
      per_section: perSection,
      suggested_edits: edits,
      input_tokens: res.usage?.input_tokens ?? 0,
      output_tokens: res.usage?.output_tokens ?? 0,
      prompt_version: PROMPT_VERSION,
    };
  } catch (err) {
    console.error("[ai-coach] generateCoachReport failed", err);
    return null;
  }
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
      return `[${m.sectionId}] ${sec}: actual ${m.actualSeconds}s, delta ${m.deltaSeconds >= 0 ? "+" : ""}${m.deltaSeconds}s, wpm ${m.wpm ?? "n/a"}, fillers ${m.fillerCount}`;
    })
    .join("\n");

  const counts = input.diffCounts;
  return `Speech: ${input.speechTitle}${input.occasion ? ` (${input.occasion})` : ""}

SECTIONS:
${sections}

PER-SECTION METRICS:
${metrics}

DIFF COUNTS:
matched=${counts.matched} paraphrased=${counts.paraphrased} skipped=${counts.skipped} improvised=${counts.improvised}

TRANSCRIPT (what they actually said):
${input.transcriptText.trim()}`;
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
  return (
    typeof r.id === "string" &&
    (r.kind === "cut" || r.kind === "adopt" || r.kind === "rephrase") &&
    typeof r.section_id === "string" &&
    typeof r.reason === "string"
  );
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
