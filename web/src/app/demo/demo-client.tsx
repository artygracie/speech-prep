"use client";

// The demo: read a speech out loud, hear what it was actually like.
//
// One fixed sample, two phases (read → report). No writing step, because
// the demo isn't a writing tool and most visitors don't have a speech yet.
// The point is the part nothing else does: you read it, and something tells
// you the truth about how it went.
//
// Nothing here touches Supabase. The recording is held in memory, POSTed
// once to /api/demo/report, and dropped.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_AUDIO_SECONDS } from "@/lib/demo-config";
import {
  SAMPLE_SECTIONS,
  SAMPLE_TARGET_SECONDS,
  SAMPLE_TITLE,
} from "@/lib/demo-sample";
import type { CoachReport } from "@/lib/ai-coach";

type Phase = "read" | "recording" | "working" | "report";

type DemoMetric = {
  sectionId: string;
  actualSeconds: number;
  deltaSeconds: number;
  wpm: number | null;
  fillerCount: number;
};

type DemoResult = {
  report: CoachReport;
  transcriptText: string;
  metrics: DemoMetric[];
};

function anonId(): string {
  try {
    const k = "sp_anon_id";
    let v = localStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "";
  }
}

function beacon(name: string, props: Record<string, unknown> = {}) {
  try {
    void fetch("/api/t", {
      method: "POST",
      body: JSON.stringify({ name, props, anon_id: anonId() }),
      keepalive: true,
    });
  } catch {
    /* analytics must never break the flow */
  }
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function DemoClient() {
  const [phase, setPhase] = useState<Phase>("read");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stopRecording = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    try {
      recRef.current?.stop();
    } catch {
      cleanup();
      setError("Recording stopped unexpectedly. Try again.");
      setPhase("read");
    }
  }, [cleanup]);

  async function submit(audio: Blob) {
    setPhase("working");
    const fd = new FormData();
    fd.set("anon_id", anonId());
    fd.set("audio", audio, "take.webm");
    try {
      const res = await fetch("/api/demo/report", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? "Something went wrong. Try again.");
        setPhase("read");
        return;
      }
      setResult(body as DemoResult);
      setPhase("report");
    } catch {
      setError("We couldn't reach the coach. Check your connection and try again.");
      setPhase("read");
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        cleanup();
        if (blob.size === 0) {
          setError("That recording came back empty. Try again.");
          setPhase("read");
          return;
        }
        void submit(blob);
      };
      recRef.current = rec;
      rec.start(1000);
      setElapsed(0);
      setPhase("recording");
      beacon("demo_started");

      const startedAt = Date.now();
      tickRef.current = setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setElapsed(s);
        if (s >= MAX_AUDIO_SECONDS) stopRecording();
      }, 200);
    } catch {
      setError(
        "We couldn't reach your microphone. Allow mic access in your browser and try again.",
      );
    }
  }

  // ── Report ────────────────────────────────────────────────────────────
  if (phase === "report" && result) {
    const metricById = new Map(result.metrics.map((m) => [m.sectionId, m]));
    const total = result.metrics.reduce((a, m) => a + m.actualSeconds, 0);
    const drift = total - SAMPLE_TARGET_SECONDS;

    return (
      <div style={{ display: "grid", gap: 28 }}>
        <div>
          <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            How that went
          </span>
          <h1 className="text-heading-lg mt-2">{result.report.headline}</h1>
          <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
            {result.report.summary}
          </p>
        </div>

        <div className="card-bordered" style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <Stat label="You took" value={fmt(total)} />
            <Stat label="Written to run" value={fmt(SAMPLE_TARGET_SECONDS)} />
            <Stat
              label={drift >= 0 ? "Slower by" : "Faster by"}
              value={fmt(Math.abs(drift))}
            />
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {result.report.per_section.map((p) => {
            const idx = Number(p.section_id.replace("demo-", ""));
            const section = SAMPLE_SECTIONS[idx];
            const m = metricById.get(p.section_id);
            return (
              <div key={p.section_id} className="card-bordered" style={{ padding: 18 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                  }}
                >
                  <strong className="text-subheading">{section?.name ?? "Section"}</strong>
                  {m && (
                    <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                      {fmt(m.actualSeconds)}
                      {m.wpm ? ` · ${Math.round(m.wpm)} wpm` : ""}
                      {m.fillerCount ? ` · ${m.fillerCount} filler` : ""}
                    </span>
                  )}
                </div>
                <p className="text-body-sm mt-2">{p.headline}</p>
                <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
                  {p.what_to_work_on}
                </p>
              </div>
            );
          })}
        </div>

        <div
          className="card-bordered"
          style={{ padding: 22, borderColor: "rgba(71,208,150,0.4)" }}
        >
          <p className="text-subheading">Now do that with the speech you have to give.</p>
          <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Bring your own script and rehearse it as many times as you like. Speeches settle on
            the fourth or fifth run, not the first.
          </p>
          <div className="mt-4" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/login" className="btn-primary" onClick={() => beacon("demo_signup")}>
              Start with my speech →
            </Link>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setResult(null);
                setError(null);
                setPhase("read");
              }}
            >
              Read it again
            </button>
          </div>
        </div>

        <details>
          <summary
            className="text-caption"
            style={{ color: "var(--color-muted-ash)", cursor: "pointer" }}
          >
            What we heard
          </summary>
          <p className="text-body-sm mt-3" style={{ color: "var(--color-muted-ash)" }}>
            {result.transcriptText}
          </p>
        </details>
      </div>
    );
  }

  // ── Working ───────────────────────────────────────────────────────────
  if (phase === "working") {
    return (
      <div style={{ display: "grid", gap: 12, justifyItems: "center", padding: "96px 0" }}>
        <p className="text-subheading">Listening back…</p>
        <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
          Timing what you said against the script. About twenty seconds.
        </p>
      </div>
    );
  }

  // ── Read / recording ──────────────────────────────────────────────────
  const isRecording = phase === "recording";
  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <h1 className="text-heading-lg">Read this out loud.</h1>
        <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
          {`A best man speech, about ${fmt(SAMPLE_TARGET_SECONDS)} if you don\u2019t rush.`}{" "}
          Read it the way you&rsquo;d actually say it and we&rsquo;ll tell you what it was really
          like. No account, and the recording isn&rsquo;t saved.
        </p>
      </div>

      <div className="card-bordered" style={{ padding: 24, display: "grid", gap: 16 }}>
        <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          {SAMPLE_TITLE}
        </span>
        {SAMPLE_SECTIONS.map((s) => (
          <p key={s.name} className="text-body" style={{ lineHeight: 1.7 }}>
            {s.body}
          </p>
        ))}
      </div>

      {error && (
        <p className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          position: "sticky",
          bottom: 24,
        }}
      >
        {isRecording ? (
          <>
            <button type="button" className="btn-primary" onClick={stopRecording}>
              Stop and hear how it went
            </button>
            <span
              className="text-subheading"
              aria-live="polite"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "var(--color-leadgen-red)",
                }}
              />
              {fmt(elapsed)}
            </span>
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={startRecording}>
            Start reading
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
        {label}
      </div>
      <div className="text-subheading mt-1">{value}</div>
    </div>
  );
}
