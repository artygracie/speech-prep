// Speech detail. Reads the speech + its current sections from the
// `current_script` view (joins through current_version automatically).

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UpgradeCard } from "@/components/upgrade-card";
import { NextStepCard } from "@/components/next-step-card";
import { gatherSpeechSignals, recommendNext } from "@/lib/lifecycle";
import DraftsPanel from "./drafts-panel";
import { SessionRowActions } from "./session-row-actions";
import { ConvergenceChart } from "./convergence-chart";

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default async function SpeechDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: speech } = await supabase
    .from("speeches")
    .select("id, title, occasion, current_version, created_at")
    .eq("id", id)
    .single();
  if (!speech) notFound();

  const { data: scriptRows } = await supabase
    .from("current_script")
    .select("section_id, position, section_name, target_seconds, body")
    .eq("speech_id", id)
    .order("position", { ascending: true });

  const sections = scriptRows ?? [];
  const targetTotal = sections.reduce((a, s) => a + (s.target_seconds ?? 0), 0);
  const totalWords = sections.reduce(
    (a, s) => a + (s.body?.split(/\s+/).filter(Boolean).length ?? 0),
    0,
  );

  // Pull real sessions for this speech.
  const { data: sessionRows } = await supabase
    .from("session_summaries")
    .select("session_id, mode, status, total_actual_seconds, total_target_seconds, created_at")
    .eq("speech_id", id)
    .order("created_at", { ascending: false });
  const sessions = sessionRows ?? [];

  // Drafts timeline. We want every script_versions row + a count of
  // sessions recorded against each version (joined client-side because
  // the schema doesn't model the relationship as a foreign key on
  // sessions.script_version_id -> script_versions.id, but we have the
  // ids on both sides so a JS-side count is fine).
  const { data: versionRows } = await supabase
    .from("script_versions")
    .select("id, v, summary, created_at, parent_version_id")
    .eq("speech_id", id)
    .order("v", { ascending: false });
  // Pull script_version_id + total spoken seconds per session — used
  // both for the "N sessions recorded against this draft" count on the
  // drafts panel and for the convergence chart.
  const { data: sessionsForChart } = await supabase
    .from("session_summaries")
    .select("session_id, script_version_id, total_actual_seconds")
    .eq("speech_id", id);
  const sessionsByVersionId = new Map<string, number>();
  const actualsByVersionId = new Map<string, number[]>();
  for (const row of sessionsForChart ?? []) {
    if (!row.script_version_id) continue;
    sessionsByVersionId.set(
      row.script_version_id,
      (sessionsByVersionId.get(row.script_version_id) ?? 0) + 1,
    );
    if (
      row.total_actual_seconds != null &&
      row.total_actual_seconds > 0
    ) {
      const arr =
        actualsByVersionId.get(row.script_version_id) ?? [];
      arr.push(row.total_actual_seconds);
      actualsByVersionId.set(row.script_version_id, arr);
    }
  }
  function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const n = s.length;
    if (n === 0) return 0;
    if (n % 2 === 1) return s[(n - 1) / 2];
    return (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  const drafts = (versionRows ?? []).map((v) => ({
    id: v.id,
    v: v.v,
    summary: v.summary,
    created_at: v.created_at,
    parent_version_id: v.parent_version_id,
    session_count: sessionsByVersionId.get(v.id) ?? 0,
  }));

  // Convergence chart data: one bar per draft that had at least one
  // session, ordered ascending by version. Bar value is median total
  // spoken seconds across the draft's sessions.
  const chartData = (versionRows ?? [])
    .slice()
    .sort((a, b) => a.v - b.v)
    .map((v) => {
      const arr = actualsByVersionId.get(v.id) ?? [];
      if (arr.length === 0) return null;
      const med = median(arr);
      const delta = med - targetTotal;
      const status: "match" | "under" | "over" =
        Math.abs(delta) <= 5 ? "match" : delta > 0 ? "over" : "under";
      return { v: v.v, actualSeconds: med, status };
    })
    .filter((x): x is { v: number; actualSeconds: number; status: "match" | "under" | "over" } => x !== null);

  // Entitlement gate. If the free plan is exhausted we replace the
  // "Record session" CTA with an inline upgrade card — that way the
  // user sees the wall here on the detail page rather than discovering
  // it after clicking through to the recorder.
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  const { data: ent } = currentUser
    ? await supabase
        .from("entitlements")
        .select("plan, free_sessions_remaining, one_shot_speech_id")
        .eq("user_id", currentUser.id)
        .maybeSingle()
    : { data: null };
  const plan = ent?.plan ?? "free";
  const isFreePlan = plan === "free";
  const freeSessionsRemaining = ent?.free_sessions_remaining ?? 3;
  // The single-speech pass is locked to one speech. If the user has a
  // pass but it's for a different speech, treat them as walled here.
  const isWrongSpeechPass =
    plan === "single_speech" &&
    ent?.one_shot_speech_id != null &&
    ent.one_shot_speech_id !== id;
  const isWalled =
    (isFreePlan && freeSessionsRemaining <= 0) || isWrongSpeechPass;

  // Lifecycle recommendation. We compute it server-side off the same
  // queries the page already does (plus a small amount more) and
  // render a NextStepCard that tells the user what to do next. We
  // suppress when walled — the upgrade flow takes precedence — and
  // when the speech has no sections (the recommendation handles that
  // case but it's redundant with the Edit script CTA).
  let recommendation: ReturnType<typeof recommendNext> | null = null;
  if (!isWalled) {
    try {
      const signals = await gatherSpeechSignals(supabase, speech.id);
      recommendation = recommendNext(signals);
    } catch (err) {
      console.error("[lifecycle] recommendation failed", err);
    }
  }

  function fmtRel(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <div>
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
          <Link href="/app" className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            ← Speeches
          </Link>
          <h1 className="text-heading-lg mt-3">{speech.title}</h1>
          <div className="flex items-center gap-3 mt-3">
            <span className="badge pill-soft">
              <span className="dot" />
              {speech.occasion ?? "Speech"}
            </span>
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              v{speech.current_version} · target {fmtTime(targetTotal)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/app/speeches/${speech.id}/print`}
            className="btn-light"
            target="_blank"
            rel="noopener"
            title="Print or save the script as a PDF"
          >
            Print
          </Link>
          <Link href={`/app/speeches/${speech.id}/edit`} className="btn-light">
            Edit script
          </Link>
          {!isWalled && (
            <Link href={`/app/speeches/${speech.id}/record`} className="btn-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4" fill="currentColor" />
              </svg>
              Record session
            </Link>
          )}
        </div>
      </div>

      {/* Upgrade gate. Surfaces only when the user actually can't
          record — either out of free sessions, or holding a one-shot
          pass for a different speech. The Free plan with sessions
          remaining gets a quieter nudge from the top-bar pill instead. */}
      {isWalled && (
        <div className="mt-8">
          <UpgradeCard
            freeSessionsRemaining={freeSessionsRemaining}
            speechId={speech.id}
            returnTo={`/app/speeches/${speech.id}`}
            context="speech-detail"
          />
        </div>
      )}

      {/* Lifecycle recommendation. The card tells the user what to do
          next given where they are in the prep arc — a fresh speech
          gets "read it aloud first," a speech with applied edits gets
          "drill the opening from memory," etc. The big "Record
          session" button stays as a top-right escape hatch. */}
      {recommendation && (
        <div className="mt-8">
          <NextStepCard recommendation={recommendation} speechId={speech.id} variant="primary" />
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-10 mt-10">
        <div className="lg:col-span-7">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading">Script</h2>
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              {sections.length} {sections.length === 1 ? "section" : "sections"} · {totalWords} words
            </span>
          </div>

          <article
            className="mt-6"
            style={{
              background: "var(--color-canvas-white)",
              borderRadius: 12,
              border: "1px solid rgba(17,17,17,0.06)",
              padding: "8px 36px 36px",
            }}
          >
            {sections.map((sec, i) => (
              <section
                key={sec.section_id}
                style={{
                  padding: "28px 0 8px",
                  borderTop: i === 0 ? "0" : "1px solid rgba(17,17,17,0.06)",
                }}
              >
                <header
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 16,
                    marginBottom: 14,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--color-muted-ash)",
                    }}
                  >
                    {sec.section_name}
                  </h3>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--color-muted-ash)",
                    }}
                  >
                    Target {fmtTime(sec.target_seconds ?? 0)}
                  </span>
                </header>
                <p
                  style={{
                    fontFamily: "var(--font-script)",
                    fontSize: 18,
                    lineHeight: 1.65,
                    color: "var(--color-midnight-ink)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {sec.body || (
                    <span style={{ color: "var(--color-muted-ash)", fontStyle: "italic" }}>
                      (empty section)
                    </span>
                  )}
                </p>
              </section>
            ))}
          </article>
        </div>

        <div className="lg:col-span-5" style={{ display: "grid", gap: 40 }}>
          <DraftsPanel
            speechId={speech.id}
            currentVersion={speech.current_version}
            drafts={drafts}
          />

          {chartData.length >= 2 && (
            <ConvergenceChart data={chartData} targetSeconds={targetTotal} />
          )}

          <div>
          <h2 className="text-heading">Sessions</h2>
          <p className="text-body mt-2" style={{ color: "var(--color-muted-ash)" }}>
            {sessions.length === 0
              ? "Hit record to see your speech come back as numbers."
              : `${sessions.length} so far.`}
          </p>

          {sessions.length === 0 ? (
            <div className="empty-state mt-5">
              <p className="text-subheading">Ready when you are.</p>
              <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
                Hit record. Speak the speech. We&rsquo;ll do the rest.
              </p>
              {!isWalled && (
                <Link
                  href={`/app/speeches/${speech.id}/record`}
                  className="btn-primary mt-6"
                  style={{ marginTop: 24 }}
                >
                  Begin session
                </Link>
              )}
            </div>
          ) : (
            <div className="mt-5" style={{ display: "grid", gap: 10 }}>
              {sessions.map((sess, i) => {
                const actual = sess.total_actual_seconds ?? 0;
                const target = sess.total_target_seconds ?? targetTotal;
                const delta = actual - target;
                const deltaColor =
                  Math.abs(delta) <= 5
                    ? "var(--color-deliver-green)"
                    : delta > 0
                    ? "var(--color-leadgen-red)"
                    : "var(--color-engagement-gold)";
                return (
                  <div
                    key={sess.session_id ?? i}
                    className="card-elevated"
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                  {sess.session_id && (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        zIndex: 2,
                      }}
                    >
                      <SessionRowActions sessionId={sess.session_id} />
                    </div>
                  )}
                  <Link
                    href={`/app/speeches/${speech.id}/sessions/${sess.session_id}`}
                    style={{
                      padding: "14px 36px 14px 16px",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      textDecoration: "none",
                      color: "inherit",
                      flex: 1,
                    }}
                  >
                    <div>
                      <div className="text-body-sm" style={{ fontWeight: 500 }}>
                        Session {sessions.length - i}{" "}
                        <span style={{ color: "var(--color-muted-ash)", fontWeight: 400 }}>
                          · {sess.mode === "with-script" ? "Teleprompter" : "Freestyle"}
                        </span>
                      </div>
                      <div className="text-caption mt-1" style={{ color: "var(--color-muted-ash)" }}>
                        {fmtRel(sess.created_at)}
                        {sess.status && sess.status !== "transcribed" ? ` · ${sess.status}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {actual > 0 ? (
                        <>
                          <div className="text-body-sm num" style={{ fontWeight: 500 }}>
                            {Math.floor(actual / 60).toString().padStart(2, "0")}:
                            {Math.floor(actual % 60).toString().padStart(2, "0")}
                          </div>
                          <div className="text-caption num" style={{ color: deltaColor }}>
                            {delta >= 0 ? "+" : "−"}
                            {Math.floor(Math.abs(delta) / 60).toString().padStart(2, "0")}:
                            {Math.floor(Math.abs(delta) % 60).toString().padStart(2, "0")}
                          </div>
                        </>
                      ) : (
                        <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                          processing
                        </div>
                      )}
                    </div>
                  </Link>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
