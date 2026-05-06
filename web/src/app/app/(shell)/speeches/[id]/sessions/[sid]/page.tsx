// Session report — the manuscript view.
//
// One mental object: the user's speech, rendered as a manuscript with
// coach edits and speaker deviations as inline track-changes. The
// coach's headline sits above the manuscript as a margin note. A
// sticky footer carries the convergence CTA (Apply & record) and an
// accepted-edits count.
//
// The diff is folded into the manuscript via a view toggle ("Coach
// edits" / "What you said" / "Both"). Pacing is folded in as inline
// section chips. Live tags become gutter markers (deferred to a
// follow-up).
//
// While the transcript and coach are still landing, an inline
// AutoRefresh component re-fetches the page every 3s and (if the
// session looks stuck) fires a wake-up to retry transcription.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPlaybackUrl } from "@/app/app/sessions-actions";
import { buildDiff, coalesceDiff, computeMemoryCheck } from "@/lib/alignment";
import type { TranscriptWord, ScriptSection, MemoryBand } from "@/lib/alignment";
import { mergeSuggestedEdits } from "@/lib/paraphrase-suggestions";
import { AutoRefresh } from "./auto-refresh";
import { PlaybackDock } from "./playback-dock";
import { ManuscriptScript, type SuggestedEdit } from "./manuscript-script";
import { UpgradeCard } from "@/components/upgrade-card";
import { NextStepCard } from "@/components/next-step-card";
import { gatherSpeechSignals, recommendNext } from "@/lib/lifecycle";
import { resolveMode, MODE_LABEL } from "@/lib/modes";

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function signTime(s: number) {
  return (s >= 0 ? "+" : "−") + fmtTime(Math.abs(s));
}

// Headline fallback when ai_reports.headline is null (legacy reports
// generated before prompt v2). We slice the first sentence and trim
// to ≤90 chars at a word boundary.
function firstSentence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  const m = trimmed.match(/^[^.!?]+[.!?]/);
  const candidate = (m ? m[0] : trimmed).trim();
  if (candidate.length <= 90) return candidate;
  const slice = candidate.slice(0, 90);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > 50 ? slice.slice(0, lastSpace).trim() : slice.trim();
}

export default async function SessionReportPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const { id: speechId, sid: sessionId } = await params;
  const supabase = await createClient();

  // Session + parent speech.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, speech_id, mode, status, duration_ms, audio_path, audio_mime, tags, created_at, script_version_id")
    .eq("id", sessionId)
    .single();
  if (!session || session.speech_id !== speechId) notFound();

  const { data: speech } = await supabase
    .from("speeches")
    .select("title")
    .eq("id", speechId)
    .single();

  // Entitlement — drives whether to show the conversion card after this
  // session.
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  const { data: ent } = currentUser
    ? await supabase
        .from("entitlements")
        .select("plan, free_sessions_remaining")
        .eq("user_id", currentUser.id)
        .maybeSingle()
    : { data: null };
  const isFreePlan = (ent?.plan ?? "free") === "free";
  const freeSessionsRemaining = ent?.free_sessions_remaining ?? 3;
  const showUpgrade = isFreePlan;

  // Sections at the version that was recorded.
  const { data: secRows } = await supabase
    .from("sections")
    .select("id, position, name, target_seconds, body")
    .eq("script_version_id", session.script_version_id)
    .order("position", { ascending: true });
  const sections: ScriptSection[] =
    secRows?.map((s) => ({
      id: s.id,
      position: s.position,
      body: s.body,
      targetSeconds: s.target_seconds,
    })) ?? [];
  const sectionNameById = new Map<string, string>(
    (secRows ?? []).map((s) => [s.id, s.name]),
  );

  // Pacing rows.
  const { data: metricsRaw } = await supabase
    .from("section_metrics")
    .select("section_id, position, actual_seconds, target_seconds, delta_seconds, wpm, filler_count, word_start_idx, word_end_idx")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const metrics = metricsRaw ?? [];

  // Transcript (if it exists).
  const { data: transcript } = await supabase
    .from("transcripts")
    .select("text, words")
    .eq("session_id", sessionId)
    .maybeSingle();

  // Coach report (if it exists).
  const { data: aiReport } = await supabase
    .from("ai_reports")
    .select("headline, summary, per_section, suggested_edits")
    .eq("session_id", sessionId)
    .maybeSingle();

  const targetTotal = sections.reduce((a, s) => a + s.targetSeconds, 0);
  const actualTotal = metrics.reduce((a, m) => a + (m.actual_seconds ?? 0), 0);
  const totalDelta = actualTotal - targetTotal;
  const currentMode = resolveMode(session.mode);
  const isFreestyle = currentMode === "freestyle";

  const playbackUrl = session.audio_path ? await getPlaybackUrl(session.audio_path) : null;

  // Diff: alignment between script and transcript.
  let diff: ReturnType<typeof buildDiff> = [];
  if (transcript?.words && Array.isArray(transcript.words) && sections.length > 0) {
    diff = coalesceDiff(buildDiff(sections, transcript.words as TranscriptWord[]));
  }

  // Per-section memory band (From-memory mode only). We index by
  // section id so the manuscript can render the chip on each heading.
  const memoryBandById = new Map<string, MemoryBand>();
  if (isFreestyle && diff.length > 0) {
    for (const r of computeMemoryCheck(sections, diff)) {
      memoryBandById.set(r.sectionId, r.band);
    }
  }

  // Pipeline state derivations.
  const hasTranscript = !!transcript?.words && Array.isArray(transcript.words);
  const hasCoach = !!aiReport;

  // Suggested edits — coach-only. We previously promoted alignment
  // paraphrases into rephrase cards, but those duplicate what the
  // inline "what you said" annotations and Delivery-notes observation
  // cards already show, and they read like edits when they're really
  // just observations. The rail now shows only coach-authored edits.
  const coachEditsRaw = (Array.isArray(aiReport?.suggested_edits)
    ? aiReport.suggested_edits
    : []) as unknown as SuggestedEdit[];
  const sectionBodyById = new Map<string, string>(
    (secRows ?? []).map((s) => [s.id, s.body ?? ""]),
  );

  // Defensive filter: drop "rephrase" suggestions whose section was a
  // memory failure (blank / rough / not-reached) in freestyle mode.
  // The coach prompt already forbids these, but legacy reports and
  // the occasional miss slip through, and the user shouldn't be asked
  // to "Accept" a rewrite of a section they blanked on. Same logic
  // for rephrases whose `before` doesn't appear verbatim in the
  // section body — those are reconstructed from the transcript and
  // don't represent actual script text to swap.
  const MEMORY_FAILURE_BANDS = new Set<MemoryBand>(["blank", "rough", "not-reached"]);
  const coachEdits = coachEditsRaw.filter((e) => {
    if (e.kind !== "rephrase") return true;
    if (isFreestyle) {
      const band = memoryBandById.get(e.section_id);
      if (band && MEMORY_FAILURE_BANDS.has(band)) return false;
    }
    if (e.before) {
      const body = sectionBodyById.get(e.section_id) ?? "";
      if (!body.toLowerCase().includes(e.before.toLowerCase())) return false;
    }
    return true;
  });

  const allEdits = mergeSuggestedEdits(
    coachEdits,
    [],
    sectionBodyById,
  ) as SuggestedEdit[];

  const pipelineDone = hasTranscript && hasCoach;
  const ageMs = Date.now() - new Date(session.created_at).getTime();
  const suspectedStuck =
    !hasTranscript && session.status !== "transcribed" && ageMs > 60_000;
  const needsCoach = hasTranscript && !hasCoach;

  // Sections shaped for the manuscript renderer — id, name, body,
  // optional pacing + memory band per section.
  const manuscriptSections = (secRows ?? []).map((s) => {
    const m = metrics.find((x) => x.section_id === s.id);
    const pacing = m
      ? {
          actualSeconds: m.actual_seconds ?? 0,
          targetSeconds: m.target_seconds ?? s.target_seconds ?? 0,
          deltaSeconds: m.delta_seconds ?? 0,
        }
      : undefined;
    return {
      id: s.id,
      name: s.name ?? "Untitled",
      body: s.body ?? "",
      pacing,
      memoryBand: memoryBandById.get(s.id),
    };
  });

  const sessionDate = new Date(session.created_at);
  const headline =
    (aiReport?.headline as string | null | undefined) ??
    firstSentence(aiReport?.summary ?? "");
  const summary = aiReport?.summary ?? "";

  // Lifecycle recommendation. Computed off the same speech, so the
  // post-take card tells the user what's next given everything that's
  // happened — including this take. We only render the card when the
  // pipeline has finished (otherwise the recommendation is based on
  // partial data and might oscillate as transcription/coach land).
  let recommendation: ReturnType<typeof recommendNext> | null = null;
  if (pipelineDone) {
    try {
      const signals = await gatherSpeechSignals(supabase, speechId);
      recommendation = recommendNext(signals);
    } catch (err) {
      console.error("[lifecycle] recommendation failed", err);
    }
  }

  return (
    <div>
      {/* Polls the page until everything's landed. Renders nothing. */}
      <AutoRefresh
        sessionId={sessionId}
        done={pipelineDone}
        suspectedStuck={suspectedStuck}
        needsCoach={needsCoach}
      />

      {/* ===== Header strip ===== */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "end",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div>
          <Link
            href={`/app/speeches/${speechId}`}
            className="text-body-sm"
            style={{ color: "var(--color-muted-ash)" }}
          >
            ← Back to {speech?.title ?? "speech"}
          </Link>
          <h1 className="text-heading-lg mt-3">Session report</h1>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              {sessionDate.toLocaleString()} · {MODE_LABEL[currentMode]}
            </span>
            {pipelineDone ? (
              <>
                <span className="badge pill-soft num">
                  <span className="dot" />
                  {fmtTime(actualTotal)} total
                </span>
                <span
                  className={`badge ${
                    totalDelta > 0 ? "pill-red" : totalDelta < -5 ? "pill-gold" : "pill-mint"
                  } num`}
                >
                  <span className="dot" />
                  {signTime(totalDelta)} vs. target
                </span>
              </>
            ) : (
              <span className="badge pill-blue">
                <span className="dot pulse" />
                {hasTranscript
                  ? "Coach is writing your feedback…"
                  : "Transcribing your recording…"}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {playbackUrl && (
            <PlaybackDock
              src={playbackUrl}
              durationSeconds={
                session.duration_ms != null
                  ? Math.round(session.duration_ms / 1000)
                  : null
              }
            />
          )}
          <Link href={`/app/speeches/${speechId}/record`} className="btn-light">
            Record again
          </Link>
        </div>
      </div>

      {/* Tiny CSS for the pulsing status dot + the loading-panel gradient.
          The gradient panel slowly drifts its origin to feel alive while
          the coach is processing — no spinner, just light moving. */}
      <style>{`
        .badge .dot.pulse {
          animation: report-pulse 1.4s ease-out infinite;
        }
        @keyframes report-pulse {
          0%   { opacity: 1; }
          50%  { opacity: 0.35; }
          100% { opacity: 1; }
        }
        .loading-panel {
          position: relative;
          border-radius: 16px;
          padding: 56px 48px;
          text-align: center;
          overflow: hidden;
          color: var(--color-midnight-ink);
          background:
            radial-gradient(386.06% 162.79% at -13.1926% -17.1008%,
              rgb(232, 64, 13) 0%,
              rgb(255, 238, 216) 26.1559%,
              rgb(208, 178, 255) 84.1533%);
          background-size: 180% 180%;
          animation: loading-drift 14s ease-in-out infinite;
          box-shadow: 0 1px 2px rgba(17,17,17,0.04), 0 12px 40px rgba(232,64,13,0.08);
        }
        @keyframes loading-drift {
          0%   { background-position: 0% 0%; }
          50%  { background-position: 100% 60%; }
          100% { background-position: 0% 0%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-panel { animation: none; }
        }
      `}</style>

      {/* ===== Coach feedback section =====
          Real h2, prose underneath. The headline is a serif pull-quote
          immediately below the heading; the supporting summary follows
          as paragraphs. No gold-rule box, no margin-note treatment —
          just a clean section the eye reads top-to-bottom. */}
      {hasCoach && (headline || summary) && (
        <section className="mt-10" style={{ maxWidth: 780 }}>
          <h2 className="text-heading">Coach feedback</h2>
          {headline && (
            <p
              className="mt-4"
              style={{
                fontFamily: "var(--font-script)",
                fontSize: 24,
                fontWeight: 500,
                lineHeight: 1.28,
                letterSpacing: "-0.012em",
                color: "var(--color-midnight-ink)",
                margin: "16px 0 0",
              }}
            >
              {headline}
            </p>
          )}
          {summary && (
            <div
              style={{
                marginTop: 14,
                fontSize: 15.5,
                lineHeight: 1.65,
                color: "rgba(17,17,17,0.82)",
              }}
            >
              {summary.split(/\n\n+/).map((para, i) => (
                <p
                  key={i}
                  style={{ margin: i === 0 ? 0 : "12px 0 0" }}
                >
                  {para.trim()}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ===== Pipeline still working ===== */}
      {!pipelineDone && (
        <div className="mt-10">
          <div className="loading-panel" style={{ maxWidth: 720 }}>
            <p className="text-subheading">
              {hasTranscript
                ? "Reading the transcript and writing your notes…"
                : "Transcribing your recording — this usually takes about a minute."}
            </p>
            <p
              className="text-body mt-3"
              style={{ color: "rgba(17,17,17,0.62)" }}
            >
              This page refreshes itself — you don&rsquo;t need to do anything.
            </p>
          </div>
        </div>
      )}

      {/* ===== Your script + adjustments rail =====
          The manuscript is the user's script with track-changes; the
          rail to its right holds Coach's adjustments + observations on
          what the user said. Lives under its own h2 so the page reads
          as two clear sections: Coach feedback (prose) → Your script
          (the document with annotations). */}
      {pipelineDone && manuscriptSections.length > 0 && (
        <section className="mt-12">
          <h2 className="text-heading">Your script</h2>
          <div className="mt-4">
            <ManuscriptScript
              speechId={speechId}
              sessionId={sessionId}
              mode={currentMode}
              sections={manuscriptSections}
              suggestedEdits={allEdits}
              diffRows={diff}
            />
          </div>
        </section>
      )}

      {/* Lifecycle "what's next" card. Renders below the manuscript so
          the user finishes reading the report and lands on a single
          contextual recommendation. The Apply-edits buttons in the
          manuscript footer are still the right call when the user
          wants to commit edits; the NextStepCard answers "where do I
          go after this?" */}
      {recommendation && (
        <div className="mt-12" style={{ maxWidth: 760 }}>
          <NextStepCard
            recommendation={recommendation}
            speechId={speechId}
            variant="compact"
          />
        </div>
      )}

      {/* ===== Upgrade nudge — bottom of page, after value ===== */}
      {showUpgrade && pipelineDone && (
        <div className="mt-14" style={{ maxWidth: 760 }}>
          <UpgradeCard
            freeSessionsRemaining={freeSessionsRemaining}
            speechId={speechId}
            context="post-session"
          />
        </div>
      )}
    </div>
  );
}
