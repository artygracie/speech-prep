// POST /api/write-speech
//
// Streams a generated speech draft from Claude. Takes the speaker's
// context (occasion, duration, raw notes/bullet points) and returns
// a plain-text stream of the speech body. The writer UI renders it
// token-by-token as it arrives.
//
// Auth: requires a logged-in Supabase session.

import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are an expert speechwriter. You write speeches that sound natural, warm, and authentic when delivered aloud — not like essays.

Your speeches have:
- A strong, specific opening that hooks the audience immediately (no "Webster's dictionary defines…")
- Conversational language — how people actually talk
- Short sentences mixed with longer ones for natural rhythm
- Concrete, specific details drawn from what the speaker gives you — never generic platitudes
- A memorable, resonant close that lands with intention

Tone by occasion:
- Wedding / toast: warm, personal, light humor if the notes suggest it
- Professional / keynote / conference: confident, evidence-grounded, inspiring without preaching
- Eulogy / memorial: honest, celebratory of the person, specific
- Graduation: forward-looking, honest about difficulty, specific to this moment
- Retirement: celebratory, grateful, specific to the person's contribution

Write for the speaker's voice, not your own. Weave in their notes and specific details naturally. If they mention names, use them.

Output the speech text only. No stage directions, no [pause] markers, no section headers, no meta-commentary. Just the words the speaker will say.`;

function wordTarget(minutes: number): number {
  return Math.round(minutes * 140);
}

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { title?: string; occasion?: string; durationMinutes?: number; notes?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const occasion = String(body.occasion ?? "").trim() || "speech";
  const title = String(body.title ?? "").trim() || "Untitled speech";
  const durationMinutes = Math.max(1, Math.min(30, Number(body.durationMinutes) || 5));
  const notes = String(body.notes ?? "").trim();
  const words = wordTarget(durationMinutes);

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "AI not configured" }, { status: 503 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMessage = `Write a ${durationMinutes}-minute ${occasion} speech titled "${title}" (~${words} words at 140 wpm).

${notes ? `Speaker's notes, bullet points, and key ideas:\n${notes}` : "No additional notes provided — write a thoughtful speech for this occasion."}

Target length: approximately ${words} words.`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: Math.max(1024, words * 2),
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        console.error("[write-speech] stream error", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Accel-Buffering": "no",
    },
  });
}
