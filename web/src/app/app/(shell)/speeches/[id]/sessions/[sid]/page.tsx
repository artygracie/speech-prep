// Session report.
//
// Layout, in priority order — these are the three things the user
// actually came here to see, in this order:
//
//   1. Their recording      — listen back to themselves
//   2. Said vs. written     — the diff between their script and what
//                             they actually said (the differentiating
//                             screen of the whole product)
//   3. Coach feedback       — the AI summary + suggested edits
//
// Below the fold (still useful, but not the headline):
//   4. Per-section pacing graph
//   5. Live notes the user flagged during recording
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
import { CoachCard } from "./coach-card";
import { AutoRefresh } from "./auto-refresh";
import { DiffDocument } from "./diff-document";

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
        <div className="flex gap-2">
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

      {/* ===== 1. RECORDING =====
          Bare audio element on the page surface — no card, no inner box.
          The native player chrome already reads as a contained widget;
          wrapping it in a card was visual padding for nothing. */}
      {playbackUrl && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
            <h2 className="text-heading">Your recording</h2>
            {session.duration_ms != null && (
              <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                {fmtTime(Math.round(session.duration_ms / 1000))} total
              </span>
            )}
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            controls
            preload="metadata"
            src={playbackUrl}
            style={{ width: "100%", marginTop: 16, display: "block" }}
          />
        </section>
      )}

      {/* ===== 2. SAID vs. WRITTEN =====
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

      {/* ===== 3. COACH ===== */}
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
          suggestedEdits={
            (Array.isArray(aiReport.suggested_edits) ? aiReport.suggested_edits : []) as unknown as {
              id: string;
              kind: "cut" | "adopt" | "rephrase";
              section_id: string;
              before?: string;
              after?: string;
              reason: string;
            }[]
          }
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

      {/* ===== 4. PACING (below the fold — useful but not the headline) ===== */}
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

      {/* ===== 5. LIVE TAGS ===== */}
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
    </div>
  );
}
