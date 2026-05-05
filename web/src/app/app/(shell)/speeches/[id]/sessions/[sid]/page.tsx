// Session report.
//
// Layout, in priority order:
//
//   1. Said vs. written     — the diff between their script and what
//                             they actually said (the differentiating
//                             screen of the whole product)
//   2. Coach feedback       — the AI summary + suggested edits
//
// Below the fold (still useful, but not the headline):
//   3. Per-section pacing graph
//   4. Live notes the user flagged during recording
//
// Audio playback lives in a "Listen back" pill in the header that, on
// click, docks a persistent mini-player at the bottom of the viewport.
// This trades a wide audio block above the diff for a non-blocking
// footer that lets you scrub while reading.
//
// While the transcript and coach are still landing, an inline
// AutoRefresh component re-fetches the page every 3s and (if the
// session looks stuck) fires a wake-up to retry transcription.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPlaybackUrl } from "@/app/app/sessions-actions";
import { buildDiff, coalesceDiff } from "@/lib/alignment";
import type { TranscriptWord, ScriptSection } from "@/lib/alignment";
import {
  promoteParaphrases,
  mergeSuggestedEdits,
} from "@/lib/paraphrase-suggestions";
import { CoachCard } from "./coach-card";
import { CoachRail } from "./coach-rail";
import { AutoDraftButton } from "./auto-draft-button";
import { AutoRefresh } from "./auto-refresh";
import { DiffDocument } from "./diff-document";
import { PlaybackDock } from "./playback-dock";
import { UpgradeCard } from "@/components/upgrade-card";

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function signTime(s: number) {
  return (s >= 0 ? "+" : "−") + fmtTime(Math.abs(s));
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
  // session. Free-plan users with sessions left get a soft nudge; users
  // who just hit the wall get the gate.
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
  // Hide the card while the pipeline is still running — we don't want
  // to interrupt the "we're processing" moment with a sales pitch.
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
    .select("summary, per_section, suggested_edits")
    .eq("session_id", sessionId)
    .maybeSingle();

  const targetTotal = sections.reduce((a, s) => a + s.targetSeconds, 0);
  const actualTotal = metrics.reduce((a, m) => a + (m.actual_seconds ?? 0), 0);
  const totalDelta = actualTotal - targetTotal;

  const playbackUrl = session.audio_path ? await getPlaybackUrl(session.audio_path) : null;

  // Diff: only if transcript has words.
  // We coalesce after building so the document view gets meaningful
  // chunks (sentence-ish), not single-token noise.
  let diff: ReturnType<typeof buildDiff> = [];
  if (transcript?.words && Array.isArray(transcript.words) && sections.length > 0) {
    diff = coalesceDiff(buildDiff(sections, transcript.words as TranscriptWord[]));
  }
  // Plain transcript text + script bodies for the Transcript / Script tabs.
  const transcriptText = (transcript?.text as string | undefined) ?? "";
  const scriptBodies: Record<string, string> = Object.fromEntries(
    (secRows ?? []).map((s) => [s.id, s.body ?? ""]),
  );
  const sectionListForDoc = sections.map((s) => ({
    id: s.id,
    name: sectionNameById.get(s.id) ?? "Section",
  }));

  // Pipeline state derivations.
  const hasTranscript = !!transcript?.words && Array.isArray(transcript.words);
  const hasCoach = !!aiReport;

  // The rail surfaces the coach summary + the single highest-priority
  // suggested edit (if any). The coach already orders edits by impact
  // when it returns them, so just take the first.
  type SuggestedEditShape = {
    id: string;
    kind: "cut" | "adopt" | "rephrase";
    section_id: string;
    before?: string;
    after?: string;
    reason: string;
  };
  const coachEdits = (Array.isArray(aiReport?.suggested_edits)
    ? aiReport.suggested_edits
    : []) as unknown as SuggestedEditShape[];
  // Promote paraphrases from the diff into deterministic "rephrase"
  // suggestions. Until the coach edge function lands, this is the only
  // source of suggestions; once it lands, coach edits dominate and we
  // dedupe.
  const promoted = diff.length > 0 ? promoteParaphrases(diff, sessionId) : [];
  const allEdits = mergeSuggestedEdits(
    coachEdits,
    promoted,
  ) as SuggestedEditShape[];
  const railEdits = allEdits;
  const topEdit: SuggestedEditShape | null = railEdits[0] ?? null;
  // The whole pipeline is "done" when both transcript AND coach landed —
  // those are the two server-side jobs that happen post-stop.
  const pipelineDone = hasTranscript && hasCoach;
  // Suspect a stuck transcribe if the session has been uploaded for
  // > 60s with no transcript. The wake handler will re-fire it.
  const ageMs = Date.now() - new Date(session.created_at).getTime();
  const suspectedStuck =
    !hasTranscript && session.status !== "transcribed" && ageMs > 60_000;

  return (
    <div>
      {/* Polls the page until everything's landed. Renders nothing. */}
      <AutoRefresh
        sessionId={sessionId}
        done={pipelineDone}
        suspectedStuck={suspectedStuck}
      />

      {/* ===== Header ===== */}
      <div style={{ display: "flex", gap: 16, alignItems: "end", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <Link href={`/app/speeches/${speechId}`} className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            ← Back to {speech?.title ?? "speech"}
          </Link>
          <h1 className="text-heading-lg mt-3">Session report</h1>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              {new Date(session.created_at).toLocaleString()} · {session.mode === "with-script" ? "Teleprompter" : "Freestyle"}
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
          <Link href={`/app/speeches/${speechId}/record`} className="btn-light">Record again</Link>
        </div>
      </div>

      {/* Tiny CSS for the pulsing status dot — only needed in this file. */}
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

      {/* Two-column body. Main content (recording, diff, coach, pacing,
          tags) flows in column 1. The CoachRail pins to column 2 on
          desktop so the answer is always one glance away. The grid
          collapses to a single column on mobile, where the rail is
          hidden because the page is already a single scroll. */}
      <style>{`
        .report-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 32px;
          margin-top: 8px;
        }
        @media (min-width: 1100px) {
          .report-grid {
            grid-template-columns: minmax(0, 1fr) 320px;
            gap: 40px;
          }
        }
        @media (max-width: 1099px) {
          .report-rail-col { display: none; }
        }
      `}</style>
      <div className="report-grid">
       <div>
      {/* Upgrade nudge — only shown on the free plan, and only once the
          pipeline has landed so we don't interrupt the "we're still
          processing" moment with a sales pitch. The variant escalates
          with how close the user is to the wall (see UpgradeCard). */}
      {showUpgrade && pipelineDone && (
        <div className="mt-10">
          <UpgradeCard
            freeSessionsRemaining={freeSessionsRemaining}
            speechId={speechId}
            context="post-session"
          />
        </div>
      )}

      {/* ===== 1. SAID vs. WRITTEN =====
          Document-style view with three tabs:
            Diff (default)  — script with track-changes inline
            Transcript      — clean rendering of what you said
            Script          — clean rendering of what you wrote
       */}
      <section className="mt-12">
        <h2 className="text-heading">What you said vs. what you wrote</h2>
        <p
          className="text-body-sm mt-2"
          style={{ color: "var(--color-muted-ash)", maxWidth: 580 }}
        >
          Edits show inline like track-changes — strikethroughs are skipped lines,
          gold highlights are paraphrases, italic blue is what you ad-libbed.
        </p>
        <div className="mt-5">
          {diff.length > 0 ? (
            <DiffDocument
              diff={diff}
              sections={sectionListForDoc}
              transcriptText={transcriptText}
              scriptBodies={scriptBodies}
            />
          ) : (
            <div className="empty-state">
              <p className="text-subheading">
                Lining up your transcript against the script…
              </p>
              <p
                className="text-body mt-3"
                style={{ color: "var(--color-muted-ash)" }}
              >
                This page refreshes itself — you don&rsquo;t need to do anything.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ===== 2. COACH ===== */}
      <div id="coach" style={{ scrollMarginTop: 24 }}>
      {hasCoach && aiReport ? (
        <CoachCard
          speechId={speechId}
          sessionId={sessionId}
          summary={aiReport.summary ?? ""}
          perSection={
            (Array.isArray(aiReport.per_section) ? aiReport.per_section : []) as unknown as {
              section_id: string;
              headline: string;
              what_landed: string;
              what_to_work_on: string;
            }[]
          }
          suggestedEdits={allEdits}
          sectionNameById={Object.fromEntries(sectionNameById)}
        />
      ) : (
        <section className="mt-14">
          <h2 className="text-heading">Coach</h2>
          <div className="empty-state mt-5">
            <p className="text-subheading">
              {hasTranscript
                ? "Reading the transcript and writing your notes…"
                : "Your coach is waiting on the transcript."}
            </p>
            <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
              Usually about a minute after the recording uploads.
            </p>
          </div>
        </section>
      )}
      </div>

      {/* ===== 3. PACING (below the fold — useful but not the headline) ===== */}
      {metrics.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading">Pacing</h2>
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              Target {fmtTime(targetTotal)} · Actual {fmtTime(actualTotal)}
            </span>
          </div>
          <div className="card-bordered mt-5" style={{ padding: 24 }}>
            <div style={{ display: "grid", gap: 18 }}>
              {sections.map((sec) => {
                const m = metrics.find((x) => x.section_id === sec.id);
                const actual = m?.actual_seconds ?? 0;
                const target = sec.targetSeconds;
                const delta = actual - target;
                const widthTarget = (target / Math.max(targetTotal, 1)) * 100;
                const widthActual = (actual / Math.max(targetTotal, 1)) * 100;
                const color =
                  Math.abs(delta) <= 5
                    ? "var(--color-deliver-green)"
                    : delta > 0
                    ? "var(--color-leadgen-red)"
                    : "var(--color-engagement-gold)";
                return (
                  <div key={sec.id}>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-body-sm" style={{ fontWeight: 500 }}>
                        {sectionNameById.get(sec.id) ?? "Untitled"}
                      </span>
                      <span className="text-body-sm num" style={{ color }}>
                        {fmtTime(actual)} / {fmtTime(target)} · {signTime(delta)}
                      </span>
                    </div>
                    <div style={{ position: "relative", height: 18 }}>
                      <div style={{ position: "absolute", inset: "6px 0", background: "rgba(17,17,17,0.04)", borderRadius: 999 }} />
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 6,
                          height: 6,
                          width: `${widthTarget}%`,
                          background: "rgba(17,17,17,0.18)",
                          borderRadius: 999,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 6,
                          height: 6,
                          width: `${widthActual}%`,
                          background: color,
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ===== 4. LIVE TAGS ===== */}
      {Array.isArray(session.tags) && session.tags.length > 0 && (
        <section className="mt-14">
          <h2 className="text-heading">Live notes you flagged</h2>
          <div className="card-bordered mt-5" style={{ padding: 24, maxWidth: 760 }}>
            {(session.tags as { kind: string; label: string; atMs: number }[]).map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderTop: i === 0 ? 0 : "1px solid rgba(17,17,17,0.06)",
                }}
              >
                <span className="text-body-sm">{t.label}</span>
                <span className="text-caption num" style={{ color: "var(--color-muted-ash)" }}>
                  {fmtTime(Math.floor((t.atMs ?? 0) / 1000))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
       </div>{/* /column 1 */}

       <div className="report-rail-col">
         {hasCoach && aiReport && (
           <CoachRail
             speechId={speechId}
             sessionId={sessionId}
             summary={aiReport.summary ?? ""}
             topEdit={topEdit}
             sectionNameById={Object.fromEntries(sectionNameById)}
           />
         )}
       </div>
      </div>{/* /report-grid */}
    </div>
  );
}
