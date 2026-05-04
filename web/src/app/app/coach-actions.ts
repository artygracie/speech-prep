"use server";

// Coach-related server actions:
//   - applySuggestions: takes a session id + a list of suggested_edit ids
//     to accept, mutates the script, and bumps the version. Same shape as
//     the original `saveScript` action, just driven from the coach card
//     instead of the editor.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase";
  section_id: string;
  before?: string;
  after?: string;
  reason: string;
};

function applyEditToBody(body: string, edit: SuggestedEdit): string {
  switch (edit.kind) {
    case "cut": {
      if (!edit.before) return body;
      // Match the substring case-insensitively, but preserve surrounding spacing.
      const idx = body.toLowerCase().indexOf(edit.before.toLowerCase());
      if (idx < 0) return body;
      const before = body.slice(0, idx).trimEnd();
      const after = body.slice(idx + edit.before.length).trimStart();
      return [before, after].filter(Boolean).join(" ");
    }
    case "adopt": {
      if (!edit.after) return body;
      // Append at the end of the section. Real version would use a more
      // careful insertion point.
      return body.trim() + " " + edit.after.trim();
    }
    case "rephrase": {
      if (!edit.before || !edit.after) return body;
      const idx = body.toLowerCase().indexOf(edit.before.toLowerCase());
      if (idx < 0) return body;
      return body.slice(0, idx) + edit.after + body.slice(idx + edit.before.length);
    }
  }
}

export async function applySuggestions(
  sessionId: string,
  acceptedIds: string[],
): Promise<{ newVersion: number }> {
  if (acceptedIds.length === 0) throw new Error("No suggestions selected");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1) Find the session and confirm ownership.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, user_id, speech_id, script_version_id")
    .eq("id", sessionId)
    .single();
  if (!session || session.user_id !== user.id) throw new Error("Session not found");

  // 2) Pull the current report so we know the suggestion bodies.
  const { data: report } = await supabase
    .from("ai_reports")
    .select("suggested_edits")
    .eq("session_id", sessionId)
    .single();
  if (!report) throw new Error("No coach report yet");
  const allEdits = (report.suggested_edits ?? []) as unknown as SuggestedEdit[];
  const accepted = allEdits.filter((e) => acceptedIds.includes(e.id));
  if (accepted.length === 0) throw new Error("None of those suggestions exist on this session");

  // 3) Find the current version and its sections (the user might have
  //    edited the script after recording — we always apply on top of the
  //    latest version so changes don't get lost).
  const { data: speech } = await supabase
    .from("speeches")
    .select("id, current_version")
    .eq("id", session.speech_id)
    .single();
  if (!speech) throw new Error("Speech not found");

  const { data: ver } = await supabase
    .from("script_versions")
    .select("id")
    .eq("speech_id", speech.id)
    .eq("v", speech.current_version)
    .single();
  if (!ver) throw new Error("Current version not found");

  const { data: sections } = await supabase
    .from("sections")
    .select("id, position, name, target_seconds, body")
    .eq("script_version_id", ver.id)
    .order("position", { ascending: true });
  if (!sections || sections.length === 0) throw new Error("No sections to edit");

  // 4) Apply each accepted edit to the right section's body.
  const editedSections = sections.map((s) => {
    let body = s.body;
    for (const edit of accepted) {
      if (edit.section_id !== s.id) continue;
      body = applyEditToBody(body, edit);
    }
    return { ...s, body };
  });

  // 5) Create a new version with the edited sections.
  const newV = speech.current_version + 1;
  await supabase.from("speeches").update({ current_version: newV }).eq("id", speech.id);

  const { data: newVer, error: insVerErr } = await supabase
    .from("script_versions")
    .insert({
      speech_id: speech.id,
      v: newV,
      summary: `Applied ${accepted.length} coach suggestion${accepted.length === 1 ? "" : "s"}`,
    })
    .select("id")
    .single();
  if (insVerErr || !newVer) throw insVerErr ?? new Error("Failed to insert version");

  const { error: secInsErr } = await supabase.from("sections").insert(
    editedSections.map((s, i) => ({
      script_version_id: newVer.id,
      position: i,
      name: s.name,
      target_seconds: s.target_seconds,
      body: s.body,
    })),
  );
  if (secInsErr) throw secInsErr;

  revalidatePath(`/app/speeches/${speech.id}`);
  revalidatePath(`/app/speeches/${speech.id}/sessions/${sessionId}`);
  return { newVersion: newV };
}

// Apply suggestions and immediately redirect into the recorder for
// the next take. Optional `practicingSectionId` query param scopes the
// next recording to a single section if the coach card called this
// from a per-section "Practice this section" link.
export async function applySuggestionsAndRecord(
  sessionId: string,
  acceptedIds: string[],
  practicingSectionId?: string,
): Promise<never> {
  const { newVersion } = await applySuggestions(sessionId, acceptedIds);
  // Re-resolve the speech id so we know where to redirect.
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("speech_id")
    .eq("id", sessionId)
    .single();
  if (!session) throw new Error("Session not found");
  const params = new URLSearchParams();
  params.set("from_v", String(newVersion));
  if (practicingSectionId) params.set("section", practicingSectionId);
  redirect(`/app/speeches/${session.speech_id}/record?${params.toString()}`);
}

// Practice just one section without applying any edits — for the
// per-section "Practice this part" link in the coach card.
export async function practiceSection(
  sessionId: string,
  sectionId: string,
): Promise<never> {
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("speech_id, user_id")
    .eq("id", sessionId)
    .single();
  if (!session) throw new Error("Session not found");
  // Note: ownership is enforced by RLS; the .single() would have
  // returned null if this user doesn't own the session.
  redirect(`/app/speeches/${session.speech_id}/record?section=${sectionId}`);
}
