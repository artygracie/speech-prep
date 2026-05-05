"use server";

// Coach-related server actions:
//   - applySuggestions: takes a session id + a list of suggested_edit ids
//     to accept, mutates the script, and bumps the version. Same shape as
//     the original `saveScript` action, just driven from the coach card
//     instead of the editor.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  buildDiff,
  coalesceDiff,
  type ScriptSection,
  type TranscriptWord,
} from "@/lib/alignment";
import {
  promoteParaphrases,
  mergeSuggestedEdits,
} from "@/lib/paraphrase-suggestions";

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

  // 2) Pull the current report (if any) and recompute paraphrase
  //    promotions from the transcript so we can apply suggestions of
  //    either origin. The session report page does the same merge for
  //    rendering — repeat it here so the ids match.
  const { data: report } = await supabase
    .from("ai_reports")
    .select("suggested_edits")
    .eq("session_id", sessionId)
    .maybeSingle();
  const coachEdits = (report?.suggested_edits ?? []) as unknown as SuggestedEdit[];

  const { data: transcript } = await supabase
    .from("transcripts")
    .select("words")
    .eq("session_id", sessionId)
    .maybeSingle();
  const { data: secRows } = await supabase
    .from("sections")
    .select("id, position, name, target_seconds, body")
    .eq("script_version_id", session.script_version_id)
    .order("position", { ascending: true });
  let promoted: ReturnType<typeof promoteParaphrases> = [];
  if (
    transcript?.words &&
    Array.isArray(transcript.words) &&
    secRows &&
    secRows.length > 0
  ) {
    const sections: ScriptSection[] = secRows.map((s) => ({
      id: s.id,
      body: s.body ?? "",
      targetSeconds: s.target_seconds ?? 0,
      position: s.position,
    }));
    const diff = coalesceDiff(
      buildDiff(sections, transcript.words as unknown as TranscriptWord[]),
    );
    promoted = promoteParaphrases(diff, sessionId);
  }
  const allEdits = mergeSuggestedEdits(
    coachEdits,
    promoted,
  ) as unknown as SuggestedEdit[];
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

// Preview an auto-drafted v(n+1) for a session: applies *all* available
// suggestions (coach + paraphrase-promoted) deterministically against
// the current version's sections and returns both the proposed
// sections and a DiffRow[] between current and proposed. The client
// uses this to render the "Show me v(n+1)" review modal — nothing is
// saved until the user explicitly commits.
export async function previewAutoDraft(sessionId: string): Promise<{
  proposedSections: Array<{
    id: string;
    name: string;
    body: string;
    target_seconds: number;
    position: number;
  }>;
  currentSections: Array<{
    id: string;
    name: string;
    body: string;
    target_seconds: number;
    position: number;
  }>;
  appliedCount: number;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, user_id, speech_id, script_version_id")
    .eq("id", sessionId)
    .single();
  if (!session || session.user_id !== user.id) throw new Error("Session not found");

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
  if (!sections || sections.length === 0) throw new Error("No sections to draft");

  // Compose suggestions the same way applySuggestions does — coach
  // edits + promoted paraphrases, deduped.
  const { data: report } = await supabase
    .from("ai_reports")
    .select("suggested_edits")
    .eq("session_id", sessionId)
    .maybeSingle();
  const coachEdits = (report?.suggested_edits ?? []) as unknown as SuggestedEdit[];

  const { data: transcript } = await supabase
    .from("transcripts")
    .select("words")
    .eq("session_id", sessionId)
    .maybeSingle();
  let promoted: ReturnType<typeof promoteParaphrases> = [];
  if (
    transcript?.words &&
    Array.isArray(transcript.words) &&
    sections.length > 0
  ) {
    const scriptSecs: ScriptSection[] = sections.map((s) => ({
      id: s.id,
      body: s.body ?? "",
      targetSeconds: s.target_seconds ?? 0,
      position: s.position,
    }));
    const diff = coalesceDiff(
      buildDiff(scriptSecs, transcript.words as unknown as TranscriptWord[]),
    );
    promoted = promoteParaphrases(diff, sessionId);
  }
  const allEdits = mergeSuggestedEdits(coachEdits, promoted) as SuggestedEdit[];

  // Apply every suggestion in order.
  const proposedSections = sections.map((s) => {
    let body = s.body;
    for (const edit of allEdits) {
      if (edit.section_id !== s.id) continue;
      body = applyEditToBody(body, edit);
    }
    return {
      id: s.id,
      name: s.name,
      body,
      target_seconds: s.target_seconds,
      position: s.position,
    };
  });

  const currentSections = sections.map((s) => ({
    id: s.id,
    name: s.name,
    body: s.body,
    target_seconds: s.target_seconds,
    position: s.position,
  }));

  return {
    proposedSections,
    currentSections,
    appliedCount: allEdits.length,
  };
}

// Commit the previewed auto-draft as a new version. Mirrors saveScript /
// applySuggestions — bumps speeches.current_version, inserts a new
// script_versions row, and writes the proposed sections under it.
// `proposedSections` comes back from previewAutoDraft and is trusted as
// the canonical content (the user reviewed it in the modal).
export async function commitAutoDraft(
  sessionId: string,
  proposedSections: Array<{
    id: string;
    name: string;
    body: string;
    target_seconds: number;
    position: number;
  }>,
): Promise<{ newVersion: number }> {
  if (!proposedSections.length) throw new Error("Empty draft");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, user_id, speech_id")
    .eq("id", sessionId)
    .single();
  if (!session || session.user_id !== user.id) throw new Error("Session not found");

  const { data: speech } = await supabase
    .from("speeches")
    .select("id, current_version")
    .eq("id", session.speech_id)
    .single();
  if (!speech) throw new Error("Speech not found");

  const newV = speech.current_version + 1;
  const { error: upErr } = await supabase
    .from("speeches")
    .update({ current_version: newV })
    .eq("id", speech.id);
  if (upErr) throw upErr;

  const { data: newVer, error: insVerErr } = await supabase
    .from("script_versions")
    .insert({
      speech_id: speech.id,
      v: newV,
      summary: `Auto-drafted from session`,
    })
    .select("id")
    .single();
  if (insVerErr || !newVer) throw insVerErr ?? new Error("Failed to insert version");

  const { error: secInsErr } = await supabase.from("sections").insert(
    proposedSections.map((s, i) => ({
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
