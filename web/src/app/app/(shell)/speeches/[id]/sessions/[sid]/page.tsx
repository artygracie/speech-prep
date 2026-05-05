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
import {
  promoteParaphrases,
  mergeSuggestedEdits,
} from "@/lib/paraphrase-suggestions";
import { AutoDraftButton } from "./auto-draft-button";
import { AutoRefresh } from "./auto-refresh";
import { PlaybackDock } from "./playback-dock";
import { ManuscriptScript, type SuggestedEdit } from "./manuscript-script";
import { CoachMarginNote } from "./coach-margin-note";
import { UpgradeCard } from "@/components/upgrade-card";
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

function fmtShortDate(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const yr = d.getFullYear() % 100;
  return `${m}/${day}/${String(yr).padStart(2, "0")}`;
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

  // Suggested edits — coach-generated + paraphrase-promoted, deduped
  // by interval overlap.
  const coachEdits = (Array.isArray(aiReport?.suggested_edits)
    ? aiReport.suggested_edits
    : []) as unknown as SuggestedEdit[];
  const promoted = diff.length > 0 ? promoteParaphrases(diff, sessionId) : [];
  const sectionBodyById = new Map<string, string>(
    (secRows ?? []).map((s) => [s.id, s.body ?? ""]),
  );
  const allEdits = mergeSuggestedEdits(
    coachEdits,
    promoted,
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
          <AutoDraftButton
            sessionId={sessionId}
            speechId={speechId}
            enabled={hasTranscript && (hasCoach || promoted.length > 0)}
          />
          <Link href={`/app/speeches/${speechId}/record`} className="btn-light">
            Record again
          </Link>
        </div>
      </div>

      {/* Tiny CSS for the pulsing status dot. */}
      <style>{`
        .badge .dot.pulse {
          animation: report-pulse 1.4s ease-out infinite;
        }
        @keyframes report-pulse {
          0%   { opacity: 1; }
          50%  { opacity: 0.35; }
          100% { opacity: 1; }
        }
      `}</style>

      {/* ===== Coach margin note ===== */}
      {hasCoach && headline && (
        <div className="mt-8">
          <CoachMarginNote
            headline={headline}
            summary={summary}
            date={fmtShortDate(sessionDate)}
          />
        </div>
      )}

      {/* ===== Pipeline still working ===== */}
      {!pipelineDone && (
        <div className="mt-10">
          <div className="empty-state" style={{ maxWidth: 720 }}>
            <p className="text-subheading">
              {hasTranscript
                ? "Reading the transcript and writing your notes…"
                : "Transcribing your recording — this usually takes about a minute."}
            </p>
            <p
              className="text-body mt-3"
              style={{ color: "var(--color-muted-ash)" }}
            >
              This page refreshes itself — you don&rsquo;t need to do anything.
            </p>
          </div>
        </div>
      )}

      {/* ===== The manuscript ===== */}
      {pipelineDone && manuscriptSections.length > 0 && (
        <div className="mt-8">
          <ManuscriptScript
            speechId={speechId}
            sessionId={sessionId}
            mode={currentMode}
            sections={manuscriptSections}
            suggestedEdits={allEdits}
            diffRows={diff}
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
