"use client";

// The demo: read a speech out loud, hear what it was actually like.
//
// One fixed sample, two phases (read → report). No writing step, because
// the demo isn't a writing tool and most visitors don't have a speech yet.
// The point is the part nothing else does: you read it, and something tells
// you the truth about how it went.
//
// Two variants:
//   "page"  — the /demo route. Stacked, its own h1.
//   "frame" — the landing page hero. A product window: script on the left,
//             a right-hand pane that is the live transcript while you read
//             and the report when you stop. The host owns the h1.
//
// Nothing here touches Supabase. The recording is held in memory, POSTed
// once to /api/demo/report, and dropped.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_AUDIO_SECONDS } from "@/lib/demo-config";
import { useStreamingTranscription } from "@/lib/use-streaming-transcription";
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

const muted = { color: "var(--color-muted-ash)" } as const;

// ── Script follow-along ─────────────────────────────────────────────────
// The script is tokenised once so each word has a global index. While the
// live transcript is running, words up to the reader's position stay ink and
// the rest fall back to muted, so the two panes read as one instrument.

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

const SCRIPT_TOKENS = (() => {
  let index = 0;
  return SAMPLE_SECTIONS.map((section) =>
    section.body.split(/(\s+)/).map((text) => {
      const key = norm(text);
      return key ? { text, key, index: index++ } : { text, key, index: -1 };
    }),
  );
})();
const SCRIPT_KEYS = SCRIPT_TOKENS.flat()
  .filter((t) => t.index >= 0)
  .map((t) => t.key);

// How far ahead a heard word may match. Wide enough to survive a skipped
// phrase, narrow enough that a common word ("the") can't jump a paragraph.
const LOOKAHEAD = 8;

function readerPosition(heard: string[]): number {
  let pos = 0;
  for (const word of heard) {
    const key = norm(word);
    if (!key) continue;
    const limit = Math.min(SCRIPT_KEYS.length, pos + LOOKAHEAD);
    for (let j = pos; j < limit; j++) {
      if (SCRIPT_KEYS[j] === key) {
        pos = j + 1;
        break;
      }
    }
  }
  return pos;
}

const METER_BARS = 16;

// Mic level meter. Bars are driven straight from an AnalyserNode through
// refs, so a 60fps meter costs no React renders. It only moves while the
// reader is making sound, which keeps it inside the brand's motion rule.
function LevelMeter({ stream }: { stream: MediaStream | null }) {
  const barsRef = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!stream) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bars = barsRef.current;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      analyser.getByteFrequencyData(data);
      bars.forEach((bar, i) => {
        if (bar) bar.style.transform = `scaleY(${Math.max(0.1, data[i + 1] / 255)})`;
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
      bars.forEach((bar) => {
        if (bar) bar.style.transform = "";
      });
    };
  }, [stream]);

  return (
    <span className="rec-meter" data-live={stream ? "" : undefined} aria-hidden="true">
      {Array.from({ length: METER_BARS }, (_, i) => (
        <i
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
        />
      ))}
    </span>
  );
}

export function DemoClient({ variant = "page" }: { variant?: "page" | "frame" } = {}) {
  const framed = variant === "frame";
  const Heading = framed ? "h2" : "h1";

  const [phase, setPhase] = useState<Phase>("read");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  // Live transcript: final words only, as they arrive. Interim results
  // flicker and get rewritten, which reads as the tool being unsure of
  // itself. Final words land once and stay.
  const [liveWords, setLiveWords] = useState<string[]>([]);
  // The utterance still in flight. Shown muted after the settled words so
  // the pane keeps pace with the reader instead of landing a phrase late.
  const [interimWords, setInterimWords] = useState<string[]>([]);
  const liveEndRef = useRef<HTMLDivElement | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // The same stream, as state, so the level meter can subscribe to it.
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMicStream(null);
    recRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const streaming = useStreamingTranscription({
    onWord: (w) => {
      if (w.isFinal) setLiveWords((prev) => [...prev, w.word]);
    },
    onInterim: setInterimWords,
    getToken: async () => {
      const res = await fetch("/api/demo/stream-token", { method: "POST" });
      if (!res.ok) throw new Error(`stream token ${res.status}`);
      return (await res.json()) as { token: string; expiresIn?: number };
    },
  });

  // Keep the newest words in view as they arrive.
  useEffect(() => {
    liveEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [liveWords.length, interimWords.length]);

  const stopRecording = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streaming.stop();
    try {
      recRef.current?.stop();
    } catch {
      cleanup();
      setError("Recording stopped unexpectedly. Try again.");
      setPhase("read");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `streaming` is a stable hook object
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
      setMicStream(stream);
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      const startedAtMs = Date.now();
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        const tookMs = Date.now() - startedAtMs;
        cleanup();
        // Diagnostics for the empty-recording report from production on
        // 2026-09-16. Cheap, and the only way to tell a sub-second tap from a
        // browser that produced no data.
        console.info("[demo] recording stopped", {
          bytes: blob.size,
          chunks: chunksRef.current.length,
          mimeType: mimeType || "(default)",
          tookMs,
        });
        if (tookMs < 1500) {
          setError("That was under two seconds. Read at least the first line, then stop.");
          setPhase("read");
          return;
        }
        if (blob.size === 0) {
          setError(
            "Your browser didn't hand us any audio. Check the mic is allowed for this site, or try Chrome.",
          );
          setPhase("read");
          return;
        }
        void submit(blob);
      };
      recRef.current = rec;
      // No timeslice. With one, Safari can deliver empty chunks and only the
      // final one carries data; without one, a single dataavailable fires on
      // stop with the whole recording. Nothing here needs progressive chunks.
      rec.start();
      setElapsed(0);
      setLiveWords([]);
      setInterimWords([]);
      setPhase("recording");
      beacon("demo_started");
      // Live words are a nice-to-have. If the socket fails the recording
      // continues and the report still comes from the full audio.
      void streaming.start(stream).catch(() => {});

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

  function reset() {
    setResult(null);
    setError(null);
    setPhase("read");
  }

  const isRecording = phase === "recording";

  // ── Shared pieces ─────────────────────────────────────────────────────

  // Follow along only when live words are actually arriving. If the socket
  // failed, the script stays fully ink rather than sitting dimmed forever.
  const following = isRecording && streaming.status === "live";
  const position = useMemo(
    () => readerPosition([...liveWords, ...interimWords]),
    [liveWords, interimWords],
  );

  const script = (
    <div style={{ display: "grid", gap: 14 }}>
      {SAMPLE_SECTIONS.map((s, i) => (
        <p key={s.name} className="text-body script-line" style={{ lineHeight: 1.7 }}>
          {SCRIPT_TOKENS[i].map((t, j) =>
            t.index < 0 ? (
              t.text
            ) : (
              <span
                key={j}
                data-ahead={following && t.index >= position ? "" : undefined}
                data-now={following && t.index === position - 1 ? "" : undefined}
              >
                {t.text}
              </span>
            ),
          )}
        </p>
      ))}
    </div>
  );

  const recordingClock = (
    <span
      className="text-subheading num"
      aria-live="polite"
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: 999, background: "var(--color-accent)" }}
      />
      {fmt(elapsed)}
    </span>
  );

  const errorLine = error && (
    <p className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
      {error}
    </p>
  );

  // The report body. One headline, one timing line, one thing to fix, one
  // button. The full breakdown and transcript sit behind one disclosure; a
  // first report that arrives as a wall of cards reads as homework.
  const reportBody = (() => {
    if (!result) return null;
    const metricById = new Map(result.metrics.map((m) => [m.sectionId, m]));
    const total = result.metrics.reduce((a, m) => a + m.actualSeconds, 0);
    const drift = Math.round(total - SAMPLE_TARGET_SECONDS);
    const rank = { high: 0, med: 1, low: 2 } as const;
    const oneThing = [...result.report.per_section].sort(
      (a, b) => rank[a.severity] - rank[b.severity],
    )[0];
    const oneThingSection = oneThing
      ? SAMPLE_SECTIONS[Number(oneThing.section_id.replace("demo-", ""))]
      : undefined;
    const timingLine =
      Math.abs(drift) < 5
        ? `${fmt(total)}, right on pace.`
        : drift > 0
          ? `${fmt(total)}, about ${drift} seconds slower than it's written to run.`
          : `${fmt(total)}, about ${-drift} seconds faster than it's written to run.`;

    return (
      <div style={{ display: "grid", gap: 22 }}>
        <div>
          <Heading className={framed ? "text-heading" : "text-heading-lg"}>
            {result.report.headline}
          </Heading>
          <p className="text-body mt-3" style={muted}>
            {timingLine}
          </p>
        </div>

        {oneThing && (
          <div className="card-bordered" style={{ padding: 20 }}>
            <span className="text-caption" style={muted}>
              The one thing to fix{oneThingSection ? ` · ${oneThingSection.name}` : ""}
            </span>
            <p className="text-subheading mt-2">{oneThing.headline}</p>
            <p className="text-body-sm mt-2" style={muted}>
              {oneThing.what_to_work_on}
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/login" className="btn-primary" onClick={() => beacon("demo_signup")}>
            Do this with my speech →
          </Link>
          <button type="button" className="btn-ghost" onClick={reset}>
            Read it again
          </button>
        </div>

        <details>
          <summary className="text-caption" style={{ ...muted, cursor: "pointer" }}>
            Full breakdown
          </summary>
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            {result.report.per_section.map((p) => {
              const section = SAMPLE_SECTIONS[Number(p.section_id.replace("demo-", ""))];
              const m = metricById.get(p.section_id);
              return (
                <div key={p.section_id} className="card-bordered" style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong className="text-body">{section?.name ?? "Section"}</strong>
                    {m && (
                      <span className="text-caption" style={muted}>
                        {fmt(m.actualSeconds)}
                        {m.wpm ? ` · ${Math.round(m.wpm)} wpm` : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-body-sm mt-2" style={muted}>
                    {p.what_to_work_on}
                  </p>
                </div>
              );
            })}
            <p className="text-caption mt-2" style={muted}>
              What we heard
            </p>
            <p className="text-body-sm" style={muted}>
              {result.transcriptText}
            </p>
          </div>
        </details>
      </div>
    );
  })();

  // ── Frame variant: a product window ───────────────────────────────────
  if (framed) {
    const status =
      phase === "recording"
        ? recordingClock
        : phase === "working"
          ? "Listening back…"
          : phase === "report"
            ? "Report"
            : "Ready";

    const pane =
      phase === "report" && reportBody ? (
        reportBody
      ) : phase === "working" ? (
        <div style={{ display: "grid", gap: 10, alignContent: "center", minHeight: 320 }}>
          <p className="text-subheading">Listening back…</p>
          <p className="text-body-sm" style={muted}>
            Timing what you said against the script. About fifteen seconds.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
          <div className="rec-console" data-recording={isRecording ? "" : undefined}>
            <button
              type="button"
              className="rec-btn"
              onClick={isRecording ? stopRecording : startRecording}
              aria-label={isRecording ? "Stop and hear how it went" : "Start reading"}
            >
              {isRecording ? (
                <span className="rec-stop" aria-hidden="true" />
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                  <path
                    d="M6 11a6 6 0 0 0 12 0M12 17v4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
            <div style={{ minWidth: 0 }}>
              <p className="text-subheading">
                {isRecording ? "Stop and hear how it went" : "Start reading"}
              </p>
              <p className="text-body-sm" style={muted}>
                {isRecording ? "Keep going. Stop whenever you like." : "Uses your mic. Nothing is saved."}
              </p>
            </div>
            <LevelMeter stream={micStream} />
            <span className="text-body-sm num" style={isRecording ? undefined : muted}>
              {fmt(elapsed)} / {fmt(SAMPLE_TARGET_SECONDS)}
            </span>
          </div>
          {errorLine}
          <div style={{ display: "grid", gap: 12 }}>
            <span className="text-caption" style={muted}>
              What we&rsquo;re hearing
            </span>
            <div
              aria-live="polite"
              style={{ minHeight: 160, maxHeight: 320, overflowY: "auto", lineHeight: 1.7 }}
              className="text-body"
            >
              {isRecording ? (
                liveWords.length + interimWords.length === 0 ? (
                  <span style={muted}>{streaming.status === "live" ? "Go ahead." : "Listening…"}</span>
                ) : (
                  <>
                    {liveWords.join(" ")} <span style={muted}>{interimWords.join(" ")}</span>
                  </>
                )
              ) : (
                <span style={muted}>
                  Your words land here as you say them. When you stop, the report takes over
                  this pane.
                </span>
              )}
              <div ref={liveEndRef} />
            </div>
          </div>
        </div>
      );

    return (
      <div className="frame">
        <div className="frame-bar">
          <span className="frame-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="text-body-sm" style={{ fontWeight: 500 }}>
            {SAMPLE_TITLE}
          </span>
          <span className="text-caption" style={{ ...muted, marginLeft: "auto" }}>
            {status}
          </span>
        </div>
        <div className="frame-body">
          <div className="frame-pane">
            <span className="text-caption" style={{ ...muted, display: "block", marginBottom: 16 }}>
              Script · about {fmt(SAMPLE_TARGET_SECONDS)}
            </span>
            {script}
          </div>
          <div className="frame-pane">{pane}</div>
        </div>
      </div>
    );
  }

  // ── Page variant ──────────────────────────────────────────────────────

  if (phase === "report" && reportBody) {
    return reportBody;
  }

  if (phase === "working") {
    return (
      <div style={{ display: "grid", gap: 12, justifyItems: "center", padding: "96px 0" }}>
        <p className="text-subheading">Listening back…</p>
        <p className="text-body-sm" style={muted}>
          Timing what you said against the script. About fifteen seconds.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <h1 className="text-heading-lg">Read this out loud.</h1>
        <p className="text-body mt-3" style={muted}>
          {`A best man speech, about ${fmt(SAMPLE_TARGET_SECONDS)} if you don’t rush.`}{" "}
          Read it the way you&rsquo;d actually say it and we&rsquo;ll tell you what it was really
          like. No account, and the recording isn&rsquo;t saved.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: isRecording ? "repeat(auto-fit, minmax(280px, 1fr))" : "1fr",
          alignItems: "start",
        }}
      >
        <div className="card-bordered" style={{ padding: 24, display: "grid", gap: 16 }}>
          <span className="text-caption" style={muted}>
            {SAMPLE_TITLE}
          </span>
          {script}
        </div>

        {isRecording && (
          <div
            className="card-bordered"
            aria-live="polite"
            style={{ padding: 24, minHeight: 200, maxHeight: 420, overflowY: "auto", position: "sticky", top: 24 }}
          >
            <span className="text-caption" style={muted}>
              What we&rsquo;re hearing
            </span>
            <p className="text-body mt-3" style={{ lineHeight: 1.7 }}>
              {liveWords.length === 0 ? (
                <span style={muted}>{streaming.status === "live" ? "Go ahead." : "Listening…"}</span>
              ) : (
                liveWords.join(" ")
              )}
            </p>
            <div ref={liveEndRef} />
          </div>
        )}
      </div>

      {errorLine}

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
            {recordingClock}
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
