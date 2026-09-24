// POST /api/refine-speech
//
// Two modes controlled by the `mode` field in the request body:
//
//   "chat"      — refine the whole speech based on a plain-language instruction.
//                 Returns the complete updated speech text as a stream.
//
//   "selection" — rewrite just a highlighted passage. `selection` must contain
//                 the verbatim text to replace. Returns only the replacement
//                 text (not the full speech), which the client splices in.
//
// Auth: requires a logged-in Supabase session.

import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";

const CHAT_SYSTEM = `You are helping a speaker refine their speech draft.

CRITICAL RULE — change as little as possible:
- If the request targets a specific part ("make the opening punchier", "fix the close", "change the second paragraph"), modify ONLY that part. Copy every other paragraph word-for-word, unchanged.
- If the request is global ("make it shorter", "change the tone", "make it funnier"), apply the change throughout but still minimise rewrites — only touch what needs to change.
- Never improve, polish, or "fix" parts the speaker didn't mention. Leave them verbatim.

Return the complete speech with the minimal edits applied. No explanations, no stage directions, no commentary.

Keep their voice. Preserve specific names, stories, and personal details exactly.`;

const SELECTION_SYSTEM = `You are helping a speaker refine a specific passage in their speech. Return ONLY the replacement text for the highlighted passage — no explanations, no quotation marks around it, no stage directions. Just the words that will replace the selection.

Match the surrounding speech's tone and voice. Keep the same approximate length unless the instruction says otherwise.`;

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    mode?: string;
    currentText?: string;
    instruction?: string;
    selection?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const mode = body.mode === "selection" ? "selection" : "chat";
  const currentText = String(body.currentText ?? "").trim();
  const instruction = String(body.instruction ?? "").trim();
  const selection = String(body.selection ?? "").trim();

  if (!instruction) return Response.json({ error: "instruction required" }, { status: 400 });
  if (!currentText) return Response.json({ error: "currentText required" }, { status: 400 });
  if (mode === "selection" && !selection) {
    return Response.json({ error: "selection required" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "AI not configured" }, { status: 503 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = mode === "selection" ? SELECTION_SYSTEM : CHAT_SYSTEM;

  const userMessage =
    mode === "selection"
      ? `Full speech for context:\n${currentText}\n\n---\n\nPassage to rewrite:\n${selection}\n\n---\n\nSpeaker's note: ${instruction}\n\nReturn only the replacement text for the selected passage.`
      : `Current speech:\n${currentText}\n\n---\n\nSpeaker's request: ${instruction}\n\nReturn the complete updated speech.`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: mode === "selection" ? 1024 : 4096,
    system: [
      {
        type: "text",
        text: systemPrompt,
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
        console.error("[refine-speech] stream error", err);
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
