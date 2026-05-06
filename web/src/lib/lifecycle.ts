// Lifecycle recommendation engine.
//
// Pure logic. Given the current state of a speech (sections, sessions,
// memory bands, coach output counts) emit a single contextual
// recommendation: a headline, a one-sentence rationale, and a primary
// action (mode + optional section scope). The user is never blocked —
// every surface that renders this offers an "I want to do something
// else" override.
//
// We intentionally do not persist a "phase" — we derive it on each
// page load. See docs/lifecycle-coaching-prd.md for the full spec.

import type { SessionMode } from "./modes";
import type { MemoryBand } from "./alignment";

export type RecommendationPhase =
  | "familiarize"          // No takes yet, or post-edit reset
  | "tighten"              // Has Script-visible takes; coach has edits to apply
  | "lock"                 // Script stable enough to start memorizing
  | "memorize_section"     // Drill the weakest section
  | "memorize_cumulative"  // Run the whole speech from memory
  | "polish"               // Cold-start full runs
  | "done"                 // Stop drilling
  | "needs_script";        // Speech has zero or empty sections

export type RecommendationAction = {
  label: string;
  href: string;
};

export type Recommendation = {
  phase: RecommendationPhase;
  headline: string;
  rationale: string;
  primaryAction: RecommendationAction;
  // Tagged for telemetry / debugging. Not user-visible.
  signals: string[];
};

// Compact session shape the engine consumes. We keep this independent
// of the database row shape so the engine is easy to unit-test.
export type SessionSignal = {
  id: string;
  mode: SessionMode;
  versionAtTime: number;          // script_versions.v at recording time
  createdAt: Date;
  // Memory bands per section, freestyle takes only. Empty for with-script.
  memoryBands: Array<{ sectionId: string; band: MemoryBand }>;
  // Counts of coach edits by kind on this session's report. Used to
  // detect "still has substantive edits to apply" in tighten phase.
  coachEditCounts: {
    cut: number;
    adopt: number;
    rephrase: number;
    drill: number;
  };
  // True once the report has been viewed AND the user has applied
  // *any* edit from it (i.e., a script_versions row was created off
  // this session). We approximate this server-side by checking
  // whether a later version exists with a parent at this take's
  // version. See gatherSpeechSignals.
  produced_followup_version: boolean;
};

export type SectionSignal = {
  id: string;
  name: string;
  position: number;
};

export type RecommendationInput = {
  speechId: string;
  currentVersion: number;
  sessions: SessionSignal[];      // newest first
  sections: SectionSignal[];       // ordered by position
  daysUntilEvent: number | null;   // not collected today; pass null
};

// ─── Helpers ─────────────────────────────────────────────────────────

const MEMORIZED_BANDS: MemoryBand[] = ["word-perfect", "mostly-there"];
const FAILURE_BANDS: MemoryBand[] = ["blank", "rough", "not-reached"];

function isMemorized(band: MemoryBand): boolean {
  return MEMORIZED_BANDS.includes(band);
}

function isFailure(band: MemoryBand): boolean {
  return FAILURE_BANDS.includes(band);
}

// Severity weight for picking the weakest section. Higher = worse.
function bandSeverity(band: MemoryBand): number {
  switch (band) {
    case "word-perfect": return 0;
    case "mostly-there": return 1;
    case "rough": return 2;
    case "blank": return 3;
    case "not-reached": return 4;
  }
}

// Pick the weakest section from a freestyle take's bands. Ties broken
// by position (earlier section wins — the speech needs to be repaired
// in order, since a blank in §2 makes §3 harder).
function pickWeakestSection(
  bands: SessionSignal["memoryBands"],
  sections: SectionSignal[],
): SectionSignal | null {
  if (bands.length === 0) return null;
  const byId = new Map(sections.map((s) => [s.id, s]));
  let bestSec: SectionSignal | null = null;
  let bestSev = -1;
  let bestPos = Infinity;
  for (const b of bands) {
    const sec = byId.get(b.sectionId);
    if (!sec) continue;
    const sev = bandSeverity(b.band);
    if (sev < 1) continue; // mostly-there or word-perfect — skip
    if (sev > bestSev || (sev === bestSev && sec.position < bestPos)) {
      bestSec = sec;
      bestSev = sev;
      bestPos = sec.position;
    }
  }
  return bestSec;
}

// Build a /record URL with optional mode + section scoping.
function recordHref(
  speechId: string,
  opts: { mode?: SessionMode; sectionId?: string; fromSessionId?: string } = {},
): string {
  const params = new URLSearchParams();
  if (opts.mode) params.set("mode", opts.mode);
  if (opts.sectionId) params.set("section", opts.sectionId);
  if (opts.fromSessionId) params.set("from_session", opts.fromSessionId);
  const qs = params.toString();
  return `/app/speeches/${speechId}/record${qs ? `?${qs}` : ""}`;
}

// Section name fallback. Some users name sections things like
// "Untitled" or leave blank. Don't put that into headline copy.
function sectionLabel(sec: SectionSignal | null, fallback = "the next section"): string {
  if (!sec) return fallback;
  const trimmed = sec.name?.trim();
  if (!trimmed || /^untitled/i.test(trimmed)) return fallback;
  return trimmed;
}

// ─── Decision tree ───────────────────────────────────────────────────

export function recommendNext(input: RecommendationInput): Recommendation {
  const { speechId, currentVersion, sessions, sections } = input;

  // Step 0: speech has no usable sections.
  if (sections.length === 0 || sections.every((s) => !s.id)) {
    return {
      phase: "needs_script",
      headline: "Add some sections first.",
      rationale: "We need a script to coach you on.",
      primaryAction: { label: "Edit script", href: `/app/speeches/${speechId}/edit` },
      signals: ["no_sections"],
    };
  }

  // Filter: only consider sessions on the current script version. A
  // session against an older version is data we'll show in the report,
  // but it can't drive the recommendation — the user has changed the
  // script since.
  const sessionsOnCurrent = sessions.filter((s) => s.versionAtTime === currentVersion);

  // Step 1: nothing recorded against the current version.
  if (sessionsOnCurrent.length === 0) {
    // If there are older sessions, this is a forced-reset (the user
    // edited the script). Otherwise it's a fresh speech.
    const isForcedReset = sessions.length > 0;
    return {
      phase: "familiarize",
      headline: isForcedReset ? "Try the new version." : "Read it aloud first.",
      rationale: isForcedReset
        ? "You changed the script. Run it once so we can hear how it lands."
        : "We'll tell you what's working and what to tighten.",
      primaryAction: {
        label: "Record with script visible",
        href: recordHref(speechId, { mode: "with-script" }),
      },
      signals: isForcedReset ? ["forced_reset_post_edit"] : ["fresh_speech"],
    };
  }

  // Most recent take on the current version. We use this heavily.
  const latest = sessionsOnCurrent[0];

  // Step 2: latest is Script-visible AND has substantive script edits
  //         AND the user hasn't already produced a follow-up version.
  if (
    latest.mode === "with-script" &&
    !latest.produced_followup_version &&
    latest.coachEditCounts.cut + latest.coachEditCounts.adopt + latest.coachEditCounts.rephrase > 0
  ) {
    return {
      phase: "tighten",
      headline: "Try those edits live.",
      rationale: "Apply the suggestions you like, then record again.",
      primaryAction: {
        label: "Open the report",
        href: `/app/speeches/${speechId}/sessions/${latest.id}`,
      },
      signals: ["with_script_with_edits"],
    };
  }

  // Step 3: ≥2 Script-visible takes on this version, latest had
  //         no/few new substantive edits → time to memorize.
  const withScriptOnCurrent = sessionsOnCurrent.filter((s) => s.mode === "with-script");
  if (
    withScriptOnCurrent.length >= 2 &&
    latest.mode === "with-script" &&
    latest.coachEditCounts.cut + latest.coachEditCounts.adopt + latest.coachEditCounts.rephrase === 0
  ) {
    const firstSec = sections[0] ?? null;
    return {
      phase: "lock",
      headline: "Time to memorize.",
      rationale: `The writing's in good shape. Drill ${sectionLabel(firstSec, "the opening")} from memory next.`,
      primaryAction: {
        label: `Drill ${sectionLabel(firstSec, "the opening")} from memory`,
        href: recordHref(speechId, { mode: "freestyle", sectionId: firstSec?.id }),
      },
      signals: ["script_locked", "two_plus_with_script", "no_new_edits"],
    };
  }

  // Step 4: latest is freestyle. Read recall.
  if (latest.mode === "freestyle") {
    const bands = latest.memoryBands;

    // 4a-iv: 3+ consecutive freestyle takes all-word-perfect → done.
    const recentFreestyle = sessionsOnCurrent.filter((s) => s.mode === "freestyle").slice(0, 3);
    const allWordPerfect = (s: SessionSignal) =>
      s.memoryBands.length > 0 &&
      s.memoryBands.every((b) => b.band === "word-perfect");
    if (recentFreestyle.length >= 3 && recentFreestyle.every(allWordPerfect)) {
      return {
        phase: "done",
        headline: "You've got it.",
        rationale:
          "Over-rehearsing now hurts more than it helps. One light run tomorrow if you want.",
        primaryAction: {
          label: "Light run from memory",
          href: recordHref(speechId, { mode: "freestyle" }),
        },
        signals: ["three_consecutive_word_perfect"],
      };
    }

    // Special case: the user gave up partway through (everything
    // not-reached). They need to re-encode from script, not drill.
    const allNotReached =
      bands.length > 0 && bands.every((b) => b.band === "not-reached");
    if (allNotReached) {
      return {
        phase: "familiarize",
        headline: "Re-anchor with the script.",
        rationale:
          "Memory needs a fresh read-through to encode. Try a Script-visible take first.",
        primaryAction: {
          label: "Record with script visible",
          href: recordHref(speechId, { mode: "with-script" }),
        },
        signals: ["all_not_reached"],
      };
    }

    // 4a-i: any blanked or rough section → drill that section.
    const weakest = pickWeakestSection(bands, sections);
    if (weakest && bands.find((b) => b.sectionId === weakest.id && isFailure(b.band))) {
      const weakBand = bands.find((b) => b.sectionId === weakest.id)?.band;
      return {
        phase: "memorize_section",
        headline: `Drill ${sectionLabel(weakest)} again.`,
        rationale:
          weakBand === "blank"
            ? `${sectionLabel(weakest, "That section")} blanked — drill it on its own first.`
            : `${sectionLabel(weakest, "That section")} is where memory's slipping.`,
        primaryAction: {
          label: `Drill ${sectionLabel(weakest)} from memory`,
          href: recordHref(speechId, { mode: "freestyle", sectionId: weakest.id }),
        },
        signals: ["weakest_section_freestyle", `band:${weakBand ?? "unknown"}`],
      };
    }

    // 4a-iii: all word-perfect on most recent → polish.
    if (bands.length > 0 && bands.every((b) => b.band === "word-perfect")) {
      return {
        phase: "polish",
        headline: "Run it cold.",
        rationale:
          "No warm-up. That's the rep that matches game day.",
        primaryAction: {
          label: "Record from memory",
          href: recordHref(speechId, { mode: "freestyle" }),
        },
        signals: ["all_word_perfect"],
      };
    }

    // 4a-ii: all sections at mostly-there or better → cumulative.
    if (bands.length > 0 && bands.every((b) => isMemorized(b.band))) {
      return {
        phase: "memorize_cumulative",
        headline: "Run the whole thing.",
        rationale: "Each section's holding — try it end to end.",
        primaryAction: {
          label: "Record from memory",
          href: recordHref(speechId, { mode: "freestyle" }),
        },
        signals: ["all_mostly_there"],
      };
    }

    // Fall-through within freestyle: bands missing or all not-reached
    // (already handled above). Recommend a script-visible re-anchor as
    // a safe default.
    return {
      phase: "familiarize",
      headline: "Read it once more.",
      rationale:
        "We didn't get a clean recall signal. A Script-visible take helps reset.",
      primaryAction: {
        label: "Record with script visible",
        href: recordHref(speechId, { mode: "with-script" }),
      },
      signals: ["freestyle_no_signal"],
    };
  }

  // Step 6: catchall. Default to "tighten" with a generic CTA.
  return {
    phase: "tighten",
    headline: "Run it again.",
    rationale: "One more take and we'll see how the writing's settling.",
    primaryAction: {
      label: "Record with script visible",
      href: recordHref(speechId, { mode: "with-script" }),
    },
    signals: ["catchall"],
  };
}

// ─── Server-side signal gatherer ─────────────────────────────────────
//
// Pulls the rows the engine needs in one place so page handlers stay
// thin. Lives here so the engine + its data shape evolve together.

import type { createClient as createServerClient } from "./supabase/server";
import { resolveMode } from "./modes";
import { buildDiff, coalesceDiff, computeMemoryCheck } from "./alignment";
import type { TranscriptWord, ScriptSection } from "./alignment";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

export async function gatherSpeechSignals(
  supabase: ServerClient,
  speechId: string,
): Promise<RecommendationInput> {
  // Speech: current_version is the only thing we need from the row.
  const { data: speech } = await supabase
    .from("speeches")
    .select("id, current_version")
    .eq("id", speechId)
    .single();
  const currentVersion = (speech as { current_version: number } | null)?.current_version ?? 1;

  // Sections (current version, ordered).
  const { data: secRows } = await supabase
    .from("current_script")
    .select("section_id, section_name, position")
    .eq("speech_id", speechId)
    .order("position", { ascending: true });
  const sections: SectionSignal[] = ((secRows ?? []) as Array<{
    section_id: string | null;
    section_name: string | null;
    position: number | null;
  }>)
    .filter((s) => !!s.section_id)
    .map((s) => ({
      id: s.section_id as string,
      name: s.section_name ?? "",
      position: s.position ?? 0,
    }));

  // Sessions for the speech, newest first. We need: id, mode,
  // script_version_id, created_at. Then we cross-reference with
  // script_versions to recover `versionAtTime`.
  const { data: sessRows } = await supabase
    .from("sessions")
    .select("id, mode, script_version_id, created_at")
    .eq("speech_id", speechId)
    .order("created_at", { ascending: false })
    .limit(20);
  const sessionRows = (sessRows ?? []) as Array<{
    id: string;
    mode: string | null;
    script_version_id: string;
    created_at: string;
  }>;

  if (sessionRows.length === 0) {
    return { speechId, currentVersion, sessions: [], sections, daysUntilEvent: null };
  }

  // Resolve script_version_id → v for each unique version_id.
  const versionIds = [...new Set(sessionRows.map((s) => s.script_version_id))];
  const { data: verRows } = await supabase
    .from("script_versions")
    .select("id, v, parent_version_id")
    .in("id", versionIds);
  const versionMap = new Map<string, { v: number; parentVersionId: string | null }>();
  for (const v of (verRows ?? []) as Array<{
    id: string;
    v: number;
    parent_version_id: string | null;
  }>) {
    versionMap.set(v.id, { v: v.v, parentVersionId: v.parent_version_id });
  }

  // Coach edit counts per session (from ai_reports.suggested_edits).
  const { data: reportRows } = await supabase
    .from("ai_reports")
    .select("session_id, suggested_edits")
    .in("session_id", sessionRows.map((s) => s.id));
  const reportMap = new Map<string, SessionSignal["coachEditCounts"]>();
  for (const r of (reportRows ?? []) as Array<{
    session_id: string;
    suggested_edits: unknown;
  }>) {
    const edits = Array.isArray(r.suggested_edits) ? (r.suggested_edits as Array<{ kind: string }>) : [];
    const counts = { cut: 0, adopt: 0, rephrase: 0, drill: 0 };
    for (const e of edits) {
      if (e.kind === "cut") counts.cut += 1;
      else if (e.kind === "adopt") counts.adopt += 1;
      else if (e.kind === "rephrase") counts.rephrase += 1;
      else if (e.kind === "drill") counts.drill += 1;
    }
    reportMap.set(r.session_id, counts);
  }

  // Memory bands per freestyle session. Computing them requires the
  // transcript + the script sections at the time. We do this only for
  // freestyle sessions (the only mode that produces a meaningful
  // recall reading), and only for sessions on the current version
  // (older sessions don't drive the recommendation; their bands are
  // wasted compute).
  const freestyleOnCurrent = sessionRows.filter(
    (s) =>
      resolveMode(s.mode) === "freestyle" &&
      versionMap.get(s.script_version_id)?.v === currentVersion,
  );
  const bandsBySession = new Map<string, SessionSignal["memoryBands"]>();
  if (freestyleOnCurrent.length > 0) {
    // We only need bodies for the current version — those are in
    // current_script via the same query we ran for sections.
    const { data: sectionRowsFull } = await supabase
      .from("current_script")
      .select("section_id, body, target_seconds, position")
      .eq("speech_id", speechId)
      .order("position", { ascending: true });
    const scriptSections: ScriptSection[] = ((sectionRowsFull ?? []) as Array<{
      section_id: string | null;
      body: string | null;
      target_seconds: number | null;
      position: number | null;
    }>)
      .filter((s) => !!s.section_id)
      .map((s) => ({
        id: s.section_id as string,
        body: s.body ?? "",
        targetSeconds: s.target_seconds ?? 0,
        position: s.position ?? 0,
      }));

    const { data: txRows } = await supabase
      .from("transcripts")
      .select("session_id, words")
      .in("session_id", freestyleOnCurrent.map((s) => s.id));
    const txMap = new Map<string, unknown>();
    for (const t of (txRows ?? []) as Array<{ session_id: string; words: unknown }>) {
      txMap.set(t.session_id, t.words);
    }

    for (const sess of freestyleOnCurrent) {
      const words = txMap.get(sess.id);
      if (!Array.isArray(words) || scriptSections.length === 0) {
        bandsBySession.set(sess.id, []);
        continue;
      }
      const diff = coalesceDiff(buildDiff(scriptSections, words as TranscriptWord[]));
      const memCheck = computeMemoryCheck(scriptSections, diff);
      bandsBySession.set(
        sess.id,
        memCheck.map((m) => ({ sectionId: m.sectionId, band: m.band })),
      );
    }
  }

  // Compute "produced_followup_version" — true if there's a
  // script_versions row whose parent_version_id points at this
  // session's version. Approximation but good enough: if the user
  // applied edits from this session's report, the resulting version
  // will have the session's version as its parent.
  const versionsByParent = new Map<string, true>();
  for (const v of versionMap.values()) {
    if (v.parentVersionId) versionsByParent.set(v.parentVersionId, true);
  }
  // We also need to check ALL versions on this speech, not just the
  // ones referenced by sessions, since a later version may have been
  // created without a session of its own yet.
  const { data: allVer } = await supabase
    .from("script_versions")
    .select("parent_version_id")
    .eq("speech_id", speechId);
  for (const v of (allVer ?? []) as Array<{ parent_version_id: string | null }>) {
    if (v.parent_version_id) versionsByParent.set(v.parent_version_id, true);
  }

  const sessions: SessionSignal[] = sessionRows.map((s) => {
    const verInfo = versionMap.get(s.script_version_id);
    return {
      id: s.id,
      mode: resolveMode(s.mode),
      versionAtTime: verInfo?.v ?? 1,
      createdAt: new Date(s.created_at),
      memoryBands: bandsBySession.get(s.id) ?? [],
      coachEditCounts: reportMap.get(s.id) ?? { cut: 0, adopt: 0, rephrase: 0, drill: 0 },
      produced_followup_version: versionsByParent.has(s.script_version_id),
    };
  });

  return { speechId, currentVersion, sessions, sections, daysUntilEvent: null };
}
