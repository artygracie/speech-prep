// Short-lived Deepgram token for the demo's live transcript.
//
// Mirrors the authed `deepgram-token` edge function exactly, minus the
// Supabase JWT requirement, which the anonymous demo cannot satisfy. Our
// long-lived key never leaves the server; the browser gets a grant that
// dies in 60 seconds and can only be used to stream audio.
//
// Spend exposure is bounded three ways: the 60s TTL, the same per-IP burst
// limit and global daily cap as /api/demo/report, and the fact that a grant
// can't be used for anything but /v1/listen.

import { allowIp, clientIp, withinGlobalDailyCap } from "@/lib/demo-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_SECONDS = 60;

export async function POST(req: Request): Promise<Response> {
  if (!allowIp(clientIp(req))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!(await withinGlobalDailyCap())) {
    return Response.json({ error: "busy" }, { status: 503 });
  }

  // .trim(): a trailing newline pasted into the secret is the #1 cause of
  // "Invalid credentials" against Deepgram with an otherwise-valid key.
  const apiKey = (process.env.DEEPGRAM_API_KEY ?? "").trim();
  if (!apiKey) {
    return Response.json({ error: "transcription_unavailable" }, { status: 503 });
  }

  try {
    const grant = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: TTL_SECONDS }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!grant.ok) {
      console.error("[demo/stream-token] grant failed:", grant.status);
      return Response.json({ error: "grant_failed" }, { status: 502 });
    }
    const { access_token, expires_in } = (await grant.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!access_token) return Response.json({ error: "grant_failed" }, { status: 502 });
    return Response.json({ token: access_token, expiresIn: expires_in ?? TTL_SECONDS });
  } catch (err) {
    console.error("[demo/stream-token] threw:", err);
    return Response.json({ error: "grant_failed" }, { status: 502 });
  }
}
