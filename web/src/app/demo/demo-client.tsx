"use client";

// The demo, in three phases: script → record → report.
//
// Nothing here touches Supabase. The recording is held in memory, POSTed
// once to /api/demo/report, and dropped. The only thing that outlives the
// page is the draft we stash in sessionStorage so that signing up carries
// the speech into the real app instead of dumping the user on a blank form.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OccasionField } from "@/components/occasion-field";
import { SAMPLE_OCCASION, SAMPLE_SPEECH, SAMPLE_TITLE } from "@/lib/demo-sample";
import { MAX_AUDIO_SECONDS, MAX_SCRIPT_CHARS } from "@/lib/demo-config";
import { saveDemoDraft } from "@/lib/demo-draft";
import type { CoachReport } from "@/lib/ai-coach";

type Phase = "script" | "record" | "working" | "report";

type DemoSection = { id: string; name: string; body: string; target_seconds: number };
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
  sections: DemoSection[];
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
  const [phase, setPhase] = useState<Phase>("script");
  const [script, setScript] = useState("");
  const [occasion, setOccasion] = useState("");
  const [title, setTitle] = useState("");
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

  function useSample() {
    setScript(SAMPLE_SPEECH);
    setOccasion(SAMPLE_OCCASION);
    setTitle(SAMPLE_TITLE);
  }

  async function submit(audio: Blob) {
    setPhase("working");
    const fd = new FormData();
    fd.set("script", script);
    fd.set("occasion", occasion);
    fd.set("title", title || "Your speech");
    fd.set("anon_id", anonId());
    fd.set("audio", audio, "take.webm");
    try {
      const res = await fetch("/api/demo/report", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? "Something went wrong. Try again.");
        setPhase("record");
        return;
      }
      setResult(body as DemoResult);
      setPhase("report");
      saveDemoDraft({ script, occasion, title: title || "Your speech" });
    } catch {
      setError("We couldn't reach the coach. Check your connection and try again.");
      setPhase("record");
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
          setPhase("record");
          return;
        }
        void submit(blob);
      };
      recRef.current = rec;
      rec.start(1000);
      setElapsed(0);
      setPhase("record");
      beacon("demo_started", { occasion: occasion || null });

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

  function stopRecording() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    try {
      recRef.current?.stop();
    } catch {
      cleanup();
      setError("Recording stopped unexpectedly. Try again.");
    }
  }

  const recording = recRef.current?.state === "recording";

  // ── Report ────────────────────────────────────────────────────────────
  if (phase === "report" && result) {
    const metricById = new Map(result.metrics.map((m) => [m.sectionId, m]));
    const total = result.metrics.reduce((a, m) => a + m.actualSeconds, 0);
    const targetTotal = result.sections.reduce((a, s) => a + s.target_seconds, 0);
    return (
      <div style={{ display: "grid", gap: 28 }}>
        <div>
          <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            Your rehearsal
          </span>
          <h1 className="text-heading-lg mt-2">{result.report.headline}</h1>
          <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
            {result.report.summary}
          </p>
        </div>

        <div className="card-bordered" style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <Stat label="You took" value={fmt(total)} />
            <Stat label="Script targets" value={fmt(targetTotal)} />
            <Stat
              label="Difference"
              value={`${total >= targetTotal ? "+" : "−"}${fmt(Math.abs(total - targetTotal))}`}
            />
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {result.report.per_section.map((p) => {
            const section = result.sections.find((s) => s.id === p.section_id);
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
          <p className="text-subheading">That was one take.</p>
          <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Speeches get better on the fourth or fifth run, not the first. Create an account to
            keep this speech, rehearse it as many times as you like, and watch the timing settle.
          </p>
          <div className="mt-4" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link
              href="/login?next=/app/onboarding"
              className="btn-primary"
              onClick={() => beacon("demo_signup", { occasion: occasion || null })}
            >
              Save this speech →
            </Link>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setResult(null);
                setError(null);
                setPhase("script");
              }}
            >
              Try another take
            </button>
          </div>
        </div>

        <details>
          <summary className="text-caption" style={{ color: "var(--color-muted-ash)", cursor: "pointer" }}>
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
      <div style={{ display: "grid", gap: 12, justifyItems: "center", padding: "80px 0" }}>
        <p className="text-subheading">Listening back…</p>
        <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
          Transcribing your take and timing it against the script. About twenty seconds.
        </p>
      </div>
    );
  }

  // ── Record ────────────────────────────────────────────────────────────
  if (phase === "record") {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <div>
          <h1 className="text-heading-lg">Give it once.</h1>
          <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
            Out loud, at the pace you&rsquo;d actually use. Up to {MAX_AUDIO_SECONDS} seconds.
            Nothing is saved.
          </p>
        </div>

        <div className="card-bordered" style={{ padding: 22, maxHeight: 260, overflowY: "auto" }}>
          <p className="text-body-sm" style={{ whiteSpace: "pre-wrap" }}>
            {script}
          </p>
        </div>

        {error && (
          <p className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {recording ? (
            <>
              <button type="button" className="btn-primary" onClick={stopRecording}>
                Stop and get my report
              </button>
              <span className="text-subheading" aria-live="polite">
                {fmt(elapsed)}
              </span>
            </>
          ) : (
            <>
              <button type="button" className="btn-primary" onClick={startRecording}>
                Start recording
              </button>
              <button type="button" className="btn-ghost" onClick={() => setPhase("script")}>
                Back to the script
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Script ────────────────────────────────────────────────────────────
  const tooLong = script.length > MAX_SCRIPT_CHARS;
  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <h1 className="text-heading-lg">Practice your speech before you give it.</h1>
        <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
          Paste what you&rsquo;ve written, read it out once, and get back your real timing, what
          you actually said versus what you wrote, and where it drags. No account needed.
        </p>
      </div>

      <div>
        <label htmlFor="demo-script" className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          Your speech
        </label>
        <textarea
          id="demo-script"
          rows={12}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Paste your speech here…"
          className="input mt-2"
          style={{ width: "100%", resize: "vertical", lineHeight: 1.6 }}
        />
        <div
          className="mt-2"
          style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
        >
          <button type="button" className="btn-ghost" onClick={useSample}>
            Don&rsquo;t have one? Use a sample
          </button>
          {tooLong && (
            <span className="text-caption" style={{ color: "var(--color-leadgen-red)" }}>
              A bit long for the demo — trim to about 1,000 words.
            </span>
          )}
        </div>
      </div>

      <OccasionField value={occasion} onChange={setOccasion} required={false} />

      {error && (
        <p className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
          {error}
        </p>
      )}

      <div>
        <button
          type="button"
          className="btn-primary"
          disabled={!script.trim() || tooLong}
          onClick={() => {
            setError(null);
            setPhase("record");
          }}
        >
          Next: read it out loud →
        </button>
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
