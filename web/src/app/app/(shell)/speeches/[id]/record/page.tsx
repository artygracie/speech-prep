// Recording page. RSC fetches the speech + sections; the actual capture
// is delegated to the Recorder client component, which owns the layout
// (two-column: script on the left, recording sidebar on the right).

import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Recorder } from "./recorder";
import { FirstRunCoach } from "./first-run-coach";
import { UpgradeCard } from "@/components/upgrade-card";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fromSessionId = typeof sp.from_session === "string" ? sp.from_session : null;
  const fromVersion = typeof sp.from_v === "string" ? Number(sp.from_v) : null;
  const isDrilling = sp.drilling === "1";
  // Lifecycle recommendation params: which mode to pre-select, and
  // (optionally) which section to scope practice to. Both default to
  // null, in which case the recorder uses its own defaults.
  const initialMode =
    sp.mode === "with-script" || sp.mode === "freestyle" ? sp.mode : null;
  const initialSectionId = typeof sp.section === "string" ? sp.section : null;
  const supabase = await createClient();

  const { data: speech } = await supabase
    .from("speeches")
    .select("id, title, current_version")
    .eq("id", id)
    .single();
  if (!speech) notFound();

  // Entitlement gate. The createSession server action enforces this
  // server-side too — but if we render the recorder UI for a walled
  // user they'd hit "click record → error → bounce to /billing", which
  // is a worse experience than just showing the upgrade options here.
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
  const freeSessionsRemaining = ent?.free_sessions_remaining ?? 3;
  const isWrongSpeechPass =
    plan === "single_speech" &&
    ent?.one_shot_speech_id != null &&
    ent.one_shot_speech_id !== id;
  const isWalled =
    (plan === "free" && freeSessionsRemaining <= 0) || isWrongSpeechPass;

  const { data: scriptRows } = await supabase
    .from("current_script")
    .select("section_id, position, section_name, target_seconds, body")
    .eq("speech_id", id)
    .order("position", { ascending: true });

  const sections = (scriptRows ?? []).map((s) => ({
    id: s.section_id ?? "",
    position: s.position ?? 0,
    name: s.section_name ?? "Untitled",
    targetSec: s.target_seconds ?? 30,
    body: s.body ?? "",
  }));

  return (
    <div>
      {/* Tight header — back link + title + version, all on one line.
          We give as much vertical space as possible to the recorder. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <Link
            href={`/app/speeches/${speech.id}`}
            className="text-body-sm"
            style={{ color: "var(--color-muted-ash)" }}
          >
            ←
          </Link>
          <h1
            style={{
              fontFamily: "var(--font-script)",
              fontSize: 22,
              lineHeight: 1.2,
              fontWeight: 500,
              letterSpacing: "-0.012em",
            }}
          >
            {speech.title}
          </h1>
          <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            v{speech.current_version}
          </span>
        </div>
      </div>

      {isWalled ? (
        <UpgradeCard
          freeSessionsRemaining={freeSessionsRemaining}
          speechId={speech.id}
          returnTo={`/app/speeches/${speech.id}/record`}
          context="recorder-gate"
        />
      ) : (
        <>
          {/* Status banner. Shows up if we got here from a session
              report's "Apply & record again" CTA, a drill action, or
              a lifecycle recommendation. The recommendation case
              prefers to render its banner from the lifecycle copy
              above the recorder rather than re-derive it client-side. */}
          {(fromSessionId || isDrilling || initialMode || initialSectionId) && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 18px",
                marginBottom: 18,
                borderRadius: 10,
                background: "rgba(50,142,250,0.06)",
                border: "1px solid rgba(50,142,250,0.18)",
                fontSize: 13.5,
                color: "var(--color-deep-indigo, #3a5fb1)",
                flexWrap: "wrap",
              }}
            >
              <span>
                {initialSectionId
                  ? `Drilling one section from memory.`
                  : initialMode === "freestyle"
                  ? `Recording from memory — script hidden.`
                  : initialMode === "with-script"
                  ? `Recording with the script visible.`
                  : isDrilling
                  ? `Drilling weak sections from your last take.`
                  : fromVersion != null
                  ? `Recording v${fromVersion} — edits applied since your last take.`
                  : `Picking up where your last take left off.`}
              </span>
              {fromSessionId && (
                <Link
                  href={`/app/speeches/${speech.id}/sessions/${fromSessionId}`}
                  className="text-body-sm"
                  style={{
                    color: "var(--color-deep-indigo, #3a5fb1)",
                    textDecoration: "underline",
                    textUnderlineOffset: 4,
                  }}
                >
                  Show what changed →
                </Link>
              )}
            </div>
          )}

          <Recorder
            speechId={speech.id}
            sections={sections}
            plan={plan}
            initialMode={initialMode}
            initialSectionId={initialSectionId}
          />

          {/* First-run coach-mark. Renders only when the user arrived from
              /app/onboarding (?firstRun=1) and hasn't dismissed it before.
              Wrapped in Suspense because it reads useSearchParams. */}
          <Suspense fallback={null}>
            <FirstRunCoach />
          </Suspense>
        </>
      )}
    </div>
  );
}
