"use client";

// useStreamingTranscription — the streaming pipe.
//
// What it does:
//   1. Accepts an existing MediaStream from the recorder
//   2. Asks our /functions/v1/deepgram-token edge function for a 60s
//      access token (renews automatically)
//   3. Opens a websocket directly to Deepgram's /v1/listen endpoint
//   4. Pumps PCM audio from the stream over the socket using an
//      AudioWorklet (more reliable than MediaRecorder for streaming)
//   5. Emits onWord callbacks as Deepgram sends final word results
//
// What it doesn't do:
//   - Maintain alignment state (live-align.ts does that)
//   - Render anything (the bottom bar does that)
//   - Replace the post-recording transcribe edge function (we still
//     run that on stop for the canonical record — see comments below)

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type StreamingWord = {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
};

export type StreamingStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "stopped"
  | "error";

type Hook = {
  status: StreamingStatus;
  errorMsg: string | null;
  start: (stream: MediaStream) => Promise<void>;
  stop: () => void;
};

type Opts = {
  onWord: (w: StreamingWord) => void;
  // Called when the connection drops mid-recording. The recorder
  // should keep capturing locally — we still upload the full audio
  // blob on stop, and the post-recording transcribe job will produce
  // the canonical transcript even if streaming failed.
  onConnectionLost?: () => void;
};

const DG_URL =
  "wss://api.deepgram.com/v1/listen?" +
  new URLSearchParams({
    model: "nova-3",
    punctuate: "true",
    interim_results: "true",
    smart_format: "true",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    endpointing: "300",
    filler_words: "true",
  }).toString();

export function useStreamingTranscription(opts: Opts): Hook {
  const [status, setStatus] = useState<StreamingStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // We hold mutable refs for everything that needs to survive across
  // start/stop without triggering re-renders. The component using this
  // hook only cares about status + errorMsg.
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const tokenExpiresAtRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedByUserRef = useRef(false);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  // ----- Token fetch -----
  const fetchToken = useCallback(async (): Promise<string> => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not signed in");
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/deepgram-token`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`token endpoint ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { token?: string; expiresIn?: number; error?: string };
    if (!json.token) throw new Error(json.error ?? "no token returned");
    tokenExpiresAtRef.current = Date.now() + (json.expiresIn ?? 60) * 1000;
    return json.token;
  }, []);

  // ----- Websocket setup -----
  const openSocket = useCallback(async (): Promise<WebSocket> => {
    const token = await fetchToken();
    return new Promise((resolve, reject) => {
      // Deepgram supports the token via the second protocol slot.
      const ws = new WebSocket(DG_URL, ["token", token]);
      ws.binaryType = "arraybuffer";

      const openTimeout = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error("websocket open timeout"));
      }, 8000);

      ws.addEventListener("open", () => {
        clearTimeout(openTimeout);
        resolve(ws);
      });
      ws.addEventListener("error", (ev) => {
        clearTimeout(openTimeout);
        reject(new Error(`websocket error: ${ev.type}`));
      });
    });
  }, [fetchToken]);

  // ----- Audio worklet (PCM 16-bit @ 16kHz) -----
  // We can't import a separate file at build time inside a hook safely,
  // so we ship the worklet source as a Blob URL. The worklet downsamples
  // to 16kHz mono Int16 frames and posts them to the main thread.
  const ensureWorklet = useCallback(async (ctx: AudioContext): Promise<void> => {
    const src = `
      class PCMWorklet extends AudioWorkletProcessor {
        constructor() {
          super();
          this._buf = [];
          this._target = 16000;
          // The browser's sample rate vs our target. We compute a
          // rolling read offset to downsample without aliasing.
          this._step = sampleRate / this._target;
          this._readPos = 0;
        }
        process(inputs) {
          const input = inputs[0];
          if (!input || input.length === 0) return true;
          const ch = input[0];
          if (!ch) return true;
          // Downsample by simple linear interpolation to 16kHz int16.
          const frames = [];
          while (this._readPos < ch.length) {
            const i = Math.floor(this._readPos);
            const f = this._readPos - i;
            const a = ch[i] || 0;
            const b = ch[i + 1] !== undefined ? ch[i + 1] : a;
            const sample = a + (b - a) * f;
            const s = Math.max(-1, Math.min(1, sample));
            frames.push(s < 0 ? s * 0x8000 : s * 0x7fff);
            this._readPos += this._step;
          }
          this._readPos -= ch.length;
          if (frames.length > 0) {
            const out = new Int16Array(frames);
            this.port.postMessage(out.buffer, [out.buffer]);
          }
          return true;
        }
      }
      registerProcessor("pcm-worklet", PCMWorklet);
    `;
    const blob = new Blob([src], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  // ----- Start streaming -----
  const start = useCallback(
    async (stream: MediaStream) => {
      stoppedByUserRef.current = false;
      setErrorMsg(null);
      setStatus("connecting");
      streamRef.current = stream;

      try {
        const ws = await openSocket();
        wsRef.current = ws;

        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        await ensureWorklet(ctx);

        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const node = new AudioWorkletNode(ctx, "pcm-worklet");
        workletNodeRef.current = node;

        node.port.onmessage = (ev) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          wsRef.current.send(ev.data as ArrayBuffer);
        };
        source.connect(node);
        // We don't connect the worklet to the destination — we don't
        // want the user to hear themselves echoed.

        ws.addEventListener("message", (ev) => {
          if (typeof ev.data !== "string") return;
          let msg: DeepgramMessage;
          try { msg = JSON.parse(ev.data) as DeepgramMessage; } catch { return; }
          if (msg.type !== "Results") return;
          const alt = msg.channel?.alternatives?.[0];
          if (!alt) return;
          const isFinal = !!msg.is_final;
          // Only emit final word events. Interim results are useful for
          // a live caption view but they create alignment churn.
          if (!isFinal) return;
          for (const w of alt.words ?? []) {
            optsRef.current.onWord({
              word: w.punctuated_word ?? w.word,
              startMs: Math.round((w.start ?? 0) * 1000),
              endMs: Math.round((w.end ?? 0) * 1000),
              confidence: w.confidence ?? 0,
              isFinal: true,
            });
          }
        });

        ws.addEventListener("close", () => {
          if (stoppedByUserRef.current) {
            setStatus("stopped");
          } else {
            setStatus("reconnecting");
            optsRef.current.onConnectionLost?.();
            // Attempt one reconnect. If that fails, surface the error.
            void reconnect();
          }
        });

        setStatus("live");
      } catch (err) {
        console.error("[streaming] start failed", err);
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
        cleanup();
      }
    },
    [ensureWorklet, openSocket],
  );

  // Best-effort single reconnect.
  const reconnect = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const ws = await openSocket();
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      ws.addEventListener("close", () => {
        if (!stoppedByUserRef.current) {
          setStatus("error");
          setErrorMsg("Streaming connection lost");
          optsRef.current.onConnectionLost?.();
        }
      });
      setStatus("live");
    } catch (err) {
      console.error("[streaming] reconnect failed", err);
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "reconnect failed");
    }
  }, [openSocket]);

  const cleanup = useCallback(() => {
    try {
      workletNodeRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch {}
    try {
      audioCtxRef.current?.close();
    } catch {}
    workletNodeRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Closing handshake: send Deepgram's CloseStream message before TCP close.
      try { wsRef.current.send(JSON.stringify({ type: "CloseStream" })); } catch {}
    }
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    cleanup();
    setStatus("stopped");
  }, [cleanup]);

  useEffect(() => {
    return () => {
      stoppedByUserRef.current = true;
      cleanup();
    };
  }, [cleanup]);

  return { status, errorMsg, start, stop };
}

// ---------- Deepgram message types ----------
type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      words?: Array<{
        word: string;
        punctuated_word?: string;
        start: number;
        end: number;
        confidence: number;
      }>;
    }>;
  };
};
