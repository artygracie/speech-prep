// Server-side Deepgram prerecorded transcription.
//
// The authed pipeline transcribes inside the `transcribe` edge function
// (web/supabase/functions/transcribe), which owns its own Deepgram call.
// The anonymous demo can't use that path — it has no session row and no
// storage object — so it calls Deepgram directly from a Next route with
// the audio held in memory and never persisted.
//
// Keep the query parameters in sync with the edge function so the demo
// report and the real report are computed from comparable transcripts.

import "server-only";
import type { TranscriptWord } from "@/lib/alignment";

const DG_URL =
  "https://api.deepgram.com/v1/listen" +
  "?model=nova-3&smart_format=true&punctuate=true&filler_words=true&language=en";

export type DeepgramResult = {
  text: string;
  words: TranscriptWord[];
};

export class DeepgramUnavailableError extends Error {}

/**
 * Transcribe an in-memory audio buffer. Throws DeepgramUnavailableError when
 * the key is missing (the caller turns that into a clean 503) and a plain
 * Error when Deepgram itself rejects the request.
 */
export async function transcribeBuffer(
  audio: ArrayBuffer,
  contentType: string,
  { timeoutMs = 45_000 }: { timeoutMs?: number } = {},
): Promise<DeepgramResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new DeepgramUnavailableError("DEEPGRAM_API_KEY is not set");
  }

  const res = await fetch(DG_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": contentType,
    },
    body: audio,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as DeepgramResponse;
  const alt = json.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) return { text: "", words: [] };

  // Deepgram reports seconds; the alignment layer works in milliseconds.
  const words: TranscriptWord[] = (alt.words ?? []).map((w) => ({
    word: w.punctuated_word ?? w.word,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    confidence: w.confidence,
  }));

  return { text: alt.transcript ?? "", words };
}

type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        words?: Array<{
          word: string;
          punctuated_word?: string;
          start: number;
          end: number;
          confidence?: number;
        }>;
      }>;
    }>;
  };
};
