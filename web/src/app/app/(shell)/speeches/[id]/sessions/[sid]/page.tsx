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
import { buildDiff, coalesceDiff, computeMemoryCheck } from "@/lib/alignment";
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
import { MemoryCheckPanel, type MemoryCheckSection } from "./memory-check-panel";
import { BetterOutLoudCard, type BetterOutLoudItem } from "./better-out-loud-card";
import { StickyCTA } from "./sticky-cta";
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
    .select("headline, summary, per_section, suggested_edits")
    .eq("session_id", sessionId)
    .maybeSingle();

  const targetTotal = sections.reduce((a, s) => a + s.targetSeconds, 0);
  const actualTotal = metrics.reduce((a, m) => a + (m.actual_seconds ?? 0), 0);
  const totalDelta = actualTotal - targetTotal;
  const currentMode = resolveMode(session.mode);
  const isFreestyle = currentMode === "freestyle";

  const playbackUrl = session.audio_path ? await getPlaybackUrl(session.audio_path) : null;

  // Diff: only if transcript has words.
  // We coalesce after building so the document view gets meaningful
  // chunks (sentence-ish), not single-token noise.
  let diff: ReturnType<typeof buildDiff> = [];
  if (transcript?.words && Array.isArray(transcript.words) && sections.length > 0) {
    diff = coalesceDiff(buildDiff(sections, transcript.words as TranscriptWord[]));
  }

  // Memory Check rows are derived from the same diff that powers the
  // diff view. We only build them in From-memory mode — Script-visible
  // mode has its own hero (Better-out-loud).
  const memoryCheckRows: MemoryCheckSection[] = isFreestyle && diff.length > 0
    ? computeMemoryCheck(sections, diff).map((r) => ({
        id: r.sectionId,
        name: sectionNameById.get(r.sectionId) ?? "Section",
        recall: r.recall,
        band: r.band,
        paraphraseCount: r.paraphraseCount,
        skippedCount: r.skippedRowCount,
        blankedAt: r.blankedAt ?? undefined,
      }))
    : [];

  // Better-out-loud items: improvised spans from the diff that have
  // substantive content (≥3 words). Disfluencies like "um yeah right"
  // are dropped. Only built in Script-visible mode — From-memory mode
  // treats improvs as memory gaps, not adoptable lines.
  const betterOutLoudItems: BetterOutLoudItem[] = !isFreestyle && diff.length > 0
    ? diff
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => row.kind === "improv" && row.sectionId)
        .map(({ row, idx }) => {
          // Type narrowed: kind === "improv" and sectionId truthy.
          const r = row as { kind: "improv"; spoken: string; sectionId: string };
          return {
            id: `improv-${r.sectionId}-${idx}`,
            sectionId: r.sectionId,
            sectionName: sectionNameById.get(r.sectionId) ?? "Section",
            spoken: r.spoken.trim(),
            wordCount: r.spoken.trim().split(/\s+/).filter(Boolean).length,
          };
        })
        .filter((item) => item.wordCount >= 3)
        // Drop the wordCount field; the component doesn't need it.
        .map(({ id, sectionId, sectionName, spoken }) => ({
          id,
          sectionId,
          sectionName,
          spoken,
        }))
    : [];

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
    kind: "cut" | "adopt" | "rephrase" | "drill";
    section_id: string;
    before?: string;
    after?: string;
    reason: string;
    line_target?: string;
    tactic?: string;
    provenance?: "coach" | "user-flag" | "alignment";
  };
  const coachEdits = (Array.isArray(aiReport?.suggested_edits)
    ? aiReport.suggested_edits
    : []) as unknown as SuggestedEditShape[];
  // Promote paraphrases from the diff into deterministic "rephrase"
  // suggestions. Until the coach edge function lands, this is the only
  // source of suggestions; once it lands, coach edits dominate and we
  // dedupe.
  const promoted = diff.length > 0 ? promoteParaphrases(diff, sessionId) : [];
  // Body map fuels the interval-based dedupe in mergeSuggestedEdits —
  // without it we fall back to a coarser prefix match and can ship
  // duplicate edits in the same section.
  const sectionBodyById = new Map<string, string>(
    Object.entries(scriptBodies),
  );
  const allEdits = mergeSuggestedEdits(
    coachEdits,
    promoted,
    sectionBodyById,
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
  // Transcript landed but coach hasn't run — AutoRefresh will fire
  // /api/coach/run directly so the report fills in without the user
  // having to do anything. Idempotent on the route side.
  const needsCoach = hasTranscript && !hasCoach;

  return (
    <div>
      {/* Polls the page until everything's landed. Renders nothing. */}
      <AutoRefresh
        sessionId={sessionId}
        done={pipelineDone}
        suspectedStuck={suspectedStuck}
        needsCoach={needsCoach}
      />

      {/* Floats above the page once the Coach scrolls out of view —
          one-click anchor back to the convergence affordance. */}
      <StickyCTA mode={currentMode} hasCoach={hasCoach} />

      {/* ===== Header ===== */}
      <div style={{ display: "flex", gap: 16, alignItems: "end", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <Link href={`/app/speeches/${speechId}`} className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            ← Back to {speech?.title ?? "speech"}
          </Link>
          <h1 className="text-heading-lg mt-3">Session report</h1>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              {new Date(session.created_at).toLocaleString()} · {MODE_LABEL[currentMode]}
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
      {/* ===== 0. MODE-SPECIFIC HERO PANELS =====
          Each mode has a different hero: Memory Check (From-memory)
          surfaces recall scoring; Better Out Loud (Script-visible)
          surfaces ad-libs that landed and could be folded back into
          the script. Both render above the coach card so the user
          sees the headline answer before scrolling. */}
      {isFreestyle && hasTranscript && memoryCheckRows.length > 0 && (
        <MemoryCheckPanel speechId={speechId} sections={memoryCheckRows} />
      )}
      {!isFreestyle && hasTranscript && betterOutLoudItems.length > 0 && (
        <BetterOutLoudCard
          sessionId={sessionId}
          items={betterOutLoudItems}
        />
      )}

      {/* ===== 1. COACH (lede — surfaces the takeaway first) =====
          The PRD makes the coach the spine of the report. Headline +
          summary + suggested edits live above the diff so the user
          sees what to fix before scrolling through transcripts. */}
      <div id="coach" style={{ scrollMarginTop: 24 }}>
      {hasCoach && aiReport ? (
        <CoachCard
          speechId={speechId}
          sessionId={sessionId}
          mode={currentMode}
          headline={
            (aiReport.headline as string | null | undefined) ??
            firstSentence(aiReport.summary ?? "")
          }
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
        <section className="mt-10">
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

      {/* ===== 2. SAID vs. WRITTEN =====
          Document-style view with three tabs (Diff / Transcript /
          Script). Both modes default to Diff — Script-visible users
          want to see deviations from the page; From-memory users want
          to see where their recall failed. The framing copy differs
          between modes; the underlying view is the same. */}
      <section className="mt-14">
        <h2 className="text-heading">{
          currentMode === "freestyle"
            ? "What you remembered, what you didn’t"
            : "What landed when you said it"
        }</h2>
        <p
          className="text-body-sm mt-2"
          style={{ color: "var(--color-muted-ash)", maxWidth: 580 }}
        >
          {currentMode === "freestyle"
            ? "Strikethroughs are lines you skipped. Gold highlights are where memory came close but not exact. Blue italic is what you said when memory filled the gap."
            : "Strikethroughs are lines you skipped. Gold highlights are where you phrased it differently than the page. Blue italic is what you added live — those are usually worth adopting into the script."}
        </p>
        <div className="mt-5">
          {diff.length > 0 ? (
            <DiffDocument
              diff={diff}
              sections={sectionListForDoc}
              mode={currentMode}
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

      {/* ===== 3. PACING =====
          Full-strength target framing in Script-visible mode. In
          From-memory mode we soften: the user's brain is doing
          memorization work, not pace work — pace targets are a
          reference, not a goal. We keep the same chart but add a
          note that flips its mental model. */}
      {metrics.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading">Pacing</h2>
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              Target {fmtTime(targetTotal)} · Actual {fmtTime(actualTotal)}
            </span>
          </div>
          {isFreestyle && (
            <p
              className="text-body-sm mt-2"
              style={{ color: "var(--color-muted-ash)", maxWidth: 580, fontStyle: "italic" }}
            >
              Pace targets reflect your script. In From-memory mode, treat them as a reference — the work here is recall, not pacing.
            </p>
          )}
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

      {/* ===== Upgrade nudge =====
          Lives at the bottom of the report — after the user has felt
          the value of the coach + diff + pacing. Selling before the
          user feels the value kneecaps perceived value (PRD W8.1). */}
      {showUpgrade && pipelineDone && (
        <div className="mt-14">
          <UpgradeCard
            freeSessionsRemaining={freeSessionsRemaining}
            speechId={speechId}
            context="post-session"
          />
        </div>
      )}
       </div>{/* /column 1 */}

       <div className="report-rail-col">
         {hasCoach && aiReport && (
           <CoachRail
             speechId={speechId}
             sessionId={sessionId}
             mode={currentMode}
             headline={
               (aiReport.headline as string | null | undefined) ??
               firstSentence(aiReport.summary ?? "")
             }
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
