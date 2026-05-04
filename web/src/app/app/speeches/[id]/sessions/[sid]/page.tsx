// Session report. The page renders four bands:
//
//  1. Header with delta-vs-target.
//  2. Pacing report — bars per section. If section_metrics rows exist
//     (i.e. transcription + alignment have run) we use those; otherwise
//     we show a polite "transcribing" placeholder.
//  3. Audio playback (signed URL into Storage).
//  4. Said-vs-written diff — only rendered if a transcript exists.
//
// All reads are RSC; nothing about the report needs interactivity.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPlaybackUrl } from "@/app/app/sessions-actions";
import { buildDiff } from "@/lib/alignment";
import type { TranscriptWord, ScriptSection } from "@/lib/alignment";
import { CoachCard } from "./coach-card";

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
  let diff: ReturnType<typeof buildDiff> = [];
  if (transcript?.words && Array.isArray(transcript.words) && sections.length > 0) {
    diff = buildDiff(sections, transcript.words as TranscriptWord[]);
  }

  return (
    <div>
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
            {metrics.length > 0 ? (
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
                <span className="dot" />
                {session.status === "uploaded" ? "Transcribing…" : session.status}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/app/speeches/${speechId}/record`} className="btn-light">Record again</Link>
        </div>
      </div>

      {/* ===== Audio playback ===== */}
      {playbackUrl && (
        <section className="mt-10">
          <h2 className="text-heading">Listen back</h2>
          <div className="card-bordered mt-5" style={{ padding: 24 }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls preload="metadata" src={playbackUrl} style={{ width: "100%" }} />
          </div>
        </section>
      )}

      {/* ===== Pacing ===== */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-heading">Pacing</h2>
          {metrics.length > 0 && (
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              Target {fmtTime(targetTotal)} · Actual {fmtTime(actualTotal)}
            </span>
          )}
        </div>

        {metrics.length === 0 ? (
          <div className="empty-state mt-5">
            <p className="text-subheading">Pacing arrives once the transcript does.</p>
            <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
              Transcription runs automatically once the recording is uploaded. Refresh in a moment.
            </p>
          </div>
        ) : (
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
        )}
      </section>

      {/* ===== Diff ===== */}
      {diff.length > 0 && (
        <section className="mt-14">
          <h2 className="text-heading">What you said vs. what you wrote</h2>
          <div className="card-elevated mt-5" style={{ padding: 28 }}>
            <div style={{ display: "grid", gap: 6 }}>
              {diff.map((row, i) => {
                if (row.kind === "match") return <p key={i} className="diff-line diff-match">&ldquo;{row.spoken}&rdquo;</p>;
                if (row.kind === "paraphrase")
                  return (
                    <p key={i} className="diff-line diff-paraphrase">
                      &ldquo;{row.spoken}&rdquo;{" "}
                      <span style={{ color: "var(--color-muted-ash)", fontStyle: "italic", fontSize: 13 }}>
                        — written: &ldquo;{row.written}&rdquo;
                      </span>
                    </p>
                  );
                if (row.kind === "skipped") return <p key={i} className="diff-line diff-skipped">&ldquo;{row.written}&rdquo;</p>;
                return <p key={i} className="diff-line diff-improv">+ &ldquo;{row.spoken}&rdquo;</p>;
              })}
            </div>

            <div className="mt-7 flex gap-2 flex-wrap">
              <span className="badge pill-soft">
                <span className="dot" />
                {diff.filter((r) => r.kind === "match").length} matched
              </span>
              <span className="badge pill-gold">
                <span className="dot" />
                {diff.filter((r) => r.kind === "paraphrase").length} paraphrased
              </span>
              <span className="badge pill-red">
                <span className="dot" />
                {diff.filter((r) => r.kind === "skipped").length} skipped
              </span>
              <span className="badge pill-blue">
                <span className="dot" />
                {diff.filter((r) => r.kind === "improv").length} ad-lib
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ===== Coach (AI report) ===== */}
      {aiReport && (
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
      )}

      {/* ===== Live tags ===== */}
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
