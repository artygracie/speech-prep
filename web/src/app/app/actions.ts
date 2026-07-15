"use server";

// Top-level server actions for the authed app: sign-out and the
// helpers used by the new-speech / script-editor flows.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aiSplitSections, aiNameSections } from "@/lib/ai-sections";
import { track } from "@/lib/track";
import { parseDateOnly } from "@/lib/lifecycle";

// How the script text arrived. "paste" and "upload" come from the intake
// forms as a hidden field; "writer" is the AI-writer flow.
type SpeechSource = "paste" | "upload" | "writer";

function speechSourceFrom(formData: FormData): SpeechSource {
  return formData.get("source") === "upload" ? "upload" : "paste";
}

// ---------- Auth ----------
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

// ---------- Speeches ----------

// Fallback paragraph splitter for when the AI call is unavailable or
// fails. Splits on blank lines; if there's only one block, splits
// sentences in half so the user has at least two sections to start
// playing with. Naming is positional and caps at 6 — past that we fall
// back to "Section N", which is ugly but rare since the AI path handles
// the long ones.
function autoSection(text: string): {
  name: string;
  target_seconds: number;
  body: string;
}[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return [{ name: "Open", target_seconds: 60, body: "" }];
  }
  if (blocks.length === 1) {
    const sentences = blocks[0].match(/[^.!?]+[.!?]+/g) ?? [blocks[0]];
    const mid = Math.ceil(sentences.length / 2);
    return [
      {
        name: "Open",
        target_seconds: estimateSeconds(sentences.slice(0, mid).join(" ")),
        body: sentences.slice(0, mid).join(" ").trim(),
      },
      {
        name: "Close",
        target_seconds: estimateSeconds(sentences.slice(mid).join(" ")),
        body: sentences.slice(mid).join(" ").trim() || sentences.join(" ").trim(),
      },
    ];
  }
  const names = ["Open", "Story", "Turn", "Close", "Aside", "Coda"];
  return blocks.map((b, i) => ({
    name: names[i] ?? `Section ${i + 1}`,
    target_seconds: estimateSeconds(b),
    body: b,
  }));
}

function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // 145 wpm, rounded to the nearest 5s, minimum 15s.
  return Math.max(15, Math.round((words / 145) * 60 / 5) * 5);
}

// Optional "When's the speech?" value from the creation flows. Returns
// a clean YYYY-MM-DD string or null — never throws. A malformed value
// simply means we don't store a date; the question is optional.
function sanitizeEventDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s && parseDateOnly(s) ? s : null;
}

// AI-first auto-section: ask Claude to find logical beats and name them,
// fall back to the paragraph heuristic if the model is unavailable or
// returns something we can't parse. Either way, we compute target_seconds
// from word count locally so timing isn't model-dependent.
async function aiOrHeuristicSection(text: string): Promise<{
  name: string;
  target_seconds: number;
  body: string;
}[]> {
  const ai = await aiSplitSections(text);
  if (ai && ai.length > 0) {
    return ai.map((s) => ({
      name: s.name,
      body: s.body,
      target_seconds: estimateSeconds(s.body),
    }));
  }
  return autoSection(text);
}

export async function createSpeech(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const occasion = String(formData.get("occasion") ?? "").trim() || null;
  const eventDate = sanitizeEventDate(formData.get("event_date"));
  const body = String(formData.get("body") ?? "").trim();

  if (!title) return; // form-side validation already requires this

  // 1) Insert the speech.
  const { data: speech, error: speechErr } = await supabase
    .from("speeches")
    .insert({
      user_id: user.id,
      title,
      occasion,
      event_date: eventDate,
      current_version: 1,
    })
    .select("id")
    .single();
  if (speechErr || !speech) throw speechErr ?? new Error("Failed to create speech");

  // 2) Insert v1 of the script.
  const { data: version, error: versionErr } = await supabase
    .from("script_versions")
    .insert({
      speech_id: speech.id,
      v: 1,
      summary: "First draft",
    })
    .select("id")
    .single();
  if (versionErr || !version) throw versionErr ?? new Error("Failed to create version");

  // 3) Auto-section the body and insert sections in position order.
  //    AI-first; falls back to the paragraph heuristic if the model is
  //    unavailable so the create flow never blocks on Anthropic.
  const proposed = body
    ? await aiOrHeuristicSection(body)
    : [{ name: "Open", target_seconds: 60, body: "" }];
  const { error: secErr } = await supabase.from("sections").insert(
    proposed.map((s, i) => ({
      script_version_id: version.id,
      position: i,
      name: s.name,
      target_seconds: s.target_seconds,
      body: s.body,
    })),
  );
  if (secErr) throw secErr;

  await track(
    "speech_created",
    { source: speechSourceFrom(formData), occasion, speech_id: speech.id },
    { userId: user.id },
  );

  revalidatePath("/app");
  redirect(`/app/speeches/${speech.id}/edit`);
}

// First-run onboarding submission. Same logic as createSpeech, but
// redirects straight to the recorder with a query flag so the recorder
// can show its first-time coach-mark. New users came here to *practice*,
// so we skip the editor — section auto-detection is good enough to
// record against, and they can refine in the editor later if they want.
export async function createFirstSpeech(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const occasion = String(formData.get("occasion") ?? "").trim() || null;
  const eventDate = sanitizeEventDate(formData.get("event_date"));
  const body = String(formData.get("body") ?? "").trim();

  if (!title) return;

  const { data: speech, error: speechErr } = await supabase
    .from("speeches")
    .insert({ user_id: user.id, title, occasion, event_date: eventDate, current_version: 1 })
    .select("id")
    .single();
  if (speechErr || !speech) throw speechErr ?? new Error("Failed to create speech");

  const { data: version, error: versionErr } = await supabase
    .from("script_versions")
    .insert({ speech_id: speech.id, v: 1, summary: "First draft" })
    .select("id")
    .single();
  if (versionErr || !version) throw versionErr ?? new Error("Failed to create version");

  const proposed = body
    ? await aiOrHeuristicSection(body)
    : [{ name: "Open", target_seconds: 60, body: "" }];
  const { error: secErr } = await supabase.from("sections").insert(
    proposed.map((s, i) => ({
      script_version_id: version.id,
      position: i,
      name: s.name,
      target_seconds: s.target_seconds,
      body: s.body,
    })),
  );
  if (secErr) throw secErr;

  await track(
    "speech_created",
    { source: speechSourceFrom(formData), occasion, speech_id: speech.id },
    { userId: user.id },
  );

  revalidatePath("/app");
  redirect(`/app/speeches/${speech.id}/record?firstRun=1`);
}

// Save the script editor's document state as a new version. Receives the
// blocks JSON from the client (heading | paragraph) and rebuilds sections.
export async function saveScript(
  speechId: string,
  blocks: Array<
    | { kind: "heading"; name: string; target_seconds: number }
    | { kind: "paragraph"; text: string }
  >,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify ownership (RLS would enforce too, but this fails fast).
  const { data: speech } = await supabase
    .from("speeches")
    .select("id, current_version, user_id")
    .eq("id", speechId)
    .single();
  if (!speech || speech.user_id !== user.id) throw new Error("Not found");

  const newV = speech.current_version + 1;

  // Bump the version pointer on the speech.
  const { error: upErr } = await supabase
    .from("speeches")
    .update({ current_version: newV })
    .eq("id", speechId);
  if (upErr) throw upErr;

  // Insert the new version row.
  const { data: version, error: versionErr } = await supabase
    .from("script_versions")
    .insert({
      speech_id: speechId,
      v: newV,
      summary: "Edited script",
    })
    .select("id")
    .single();
  if (versionErr || !version) throw versionErr ?? new Error("Failed to insert version");

  // Walk blocks and group paragraphs under the preceding heading.
  type Sec = { name: string; target_seconds: number; bodyParts: string[] };
  const sections: Sec[] = [];
  let cur: Sec | null = null;
  for (const b of blocks) {
    if (b.kind === "heading") {
      cur = { name: b.name || "Untitled", target_seconds: Math.max(5, b.target_seconds | 0), bodyParts: [] };
      sections.push(cur);
    } else {
      if (!cur) {
        cur = { name: "Untitled", target_seconds: 30, bodyParts: [] };
        sections.push(cur);
      }
      if (b.text) cur.bodyParts.push(b.text);
    }
  }
  if (sections.length === 0) {
    sections.push({ name: "Open", target_seconds: 60, bodyParts: [""] });
  }

  const { error: secErr } = await supabase.from("sections").insert(
    sections.map((s, i) => ({
      script_version_id: version.id,
      position: i,
      name: s.name,
      target_seconds: s.target_seconds,
      body: s.bodyParts.join("\n\n"),
    })),
  );
  if (secErr) throw secErr;

  revalidatePath(`/app/speeches/${speechId}`);
  revalidatePath(`/app/speeches/${speechId}/edit`);
  return { newVersion: newV };
}

// Create a speech from the AI writer flow. Takes the finished text
// directly (no FormData) so the writer client can call it from a
// useTransition. Auto-sections with the same AI path as createFirstSpeech
// and redirects to the recorder.
export async function createSpeechFromWriter(
  title: string,
  body: string,
  eventDate?: string | null,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: speech, error: speechErr } = await supabase
    .from("speeches")
    .insert({
      user_id: user.id,
      title: title.trim() || "Untitled speech",
      event_date: sanitizeEventDate(eventDate),
      current_version: 1,
    })
    .select("id")
    .single();
  if (speechErr || !speech) throw speechErr ?? new Error("Failed to create speech");

  const { data: version, error: versionErr } = await supabase
    .from("script_versions")
    .insert({ speech_id: speech.id, v: 1, summary: "AI-written draft" })
    .select("id")
    .single();
  if (versionErr || !version) throw versionErr ?? new Error("Failed to create version");

  const proposed = body.trim()
    ? await aiOrHeuristicSection(body)
    : [{ name: "Open", target_seconds: 60, body: "" }];
  const { error: secErr } = await supabase.from("sections").insert(
    proposed.map((s, i) => ({
      script_version_id: version.id,
      position: i,
      name: s.name,
      target_seconds: s.target_seconds,
      body: s.body,
    })),
  );
  if (secErr) throw secErr;

  await track(
    "speech_created",
    { source: "writer", occasion: null, speech_id: speech.id },
    { userId: user.id },
  );

  revalidatePath("/app");
  redirect(`/app/speeches/${speech.id}/record?firstRun=1`);
}

// Restore a prior version. Implemented additively: copy the chosen
// version's sections into a brand-new version (v = current+1) with a
// summary of "Rolled back to v{N}". The original version stays in place,
// so a restore is itself reversible — nothing is destroyed.
export async function restoreVersion(
  speechId: string,
  v: number,
): Promise<{ newVersion: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: speech } = await supabase
    .from("speeches")
    .select("id, current_version, user_id")
    .eq("id", speechId)
    .single();
  if (!speech || speech.user_id !== user.id) throw new Error("Not found");
  if (v === speech.current_version) {
    return { newVersion: speech.current_version };
  }

  const { data: src } = await supabase
    .from("script_versions")
    .select("id")
    .eq("speech_id", speechId)
    .eq("v", v)
    .single();
  if (!src) throw new Error(`Version v${v} not found`);

  const { data: srcSections } = await supabase
    .from("sections")
    .select("position, name, target_seconds, body")
    .eq("script_version_id", src.id)
    .order("position", { ascending: true });
  if (!srcSections || srcSections.length === 0) {
    throw new Error("That version has no sections to restore");
  }

  const newV = speech.current_version + 1;
  const { error: upErr } = await supabase
    .from("speeches")
    .update({ current_version: newV })
    .eq("id", speechId);
  if (upErr) throw upErr;

  const { data: newVer, error: insVerErr } = await supabase
    .from("script_versions")
    .insert({
      speech_id: speechId,
      v: newV,
      summary: `Rolled back to v${v}`,
      parent_version_id: src.id,
    })
    .select("id")
    .single();
  if (insVerErr || !newVer) throw insVerErr ?? new Error("Failed to insert version");

  const { error: secErr } = await supabase.from("sections").insert(
    srcSections.map((s, i) => ({
      script_version_id: newVer.id,
      position: i,
      name: s.name,
      target_seconds: s.target_seconds,
      body: s.body,
    })),
  );
  if (secErr) throw secErr;

  revalidatePath(`/app/speeches/${speechId}`);
  revalidatePath(`/app/speeches/${speechId}/edit`);
  return { newVersion: newV };
}

// Editor "Suggest names" button. Takes the current section bodies (as the
// user has them in-editor, before save) and returns one new name per
// section. We don't persist anything — the editor patches its local
// state and the names land in the next save.
export async function suggestSectionNames(
  bodies: string[],
): Promise<{ names: string[] | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { names: null };
  if (!Array.isArray(bodies) || bodies.length === 0) return { names: null };
  // Cap input — runaway pastes shouldn't blow our token budget.
  if (bodies.length > 20) return { names: null };

  const names = await aiNameSections(bodies.map((b) => ({ body: String(b) })));
  return { names };
}
