"use server";

// Coach-related server actions:
//   - applySuggestions: takes a session id + a list of suggested_edit ids
//     to accept, mutates the script, and bumps the version. Same shape as
//     the original `saveScript` action, just driven from the coach card
//     instead of the editor.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mergeSuggestedEdits } from "@/lib/paraphrase-suggestions";

type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase" | "drill";
  section_id: string;
  before?: string;
  after?: string;
  // adopt-only (prompt v3+): the new text being inserted at the
  // `before` anchor. Pre-v3 reports may omit this; the apply path
  // recovers an insertion from `after` when possible.
  insertion?: string;
  reason: string;
  // drill-only fields
  line_target?: string;
  tactic?: string;
  // tagged by the coach / paraphrase promoter / live-flag deriver
  provenance?: "coach" | "user-flag" | "alignment";
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
      // ADOPT = insert NEW text into the script at a specific anchor.
      //
      // Prompt v3+ contract:
      //   - `before`    = verbatim script substring that ANCHORS the
      //                   insertion. New text is inserted directly
      //                   after this substring.
      //   - `insertion` = ONLY the new words to add (not the full
      //                   revised passage).
      //
      // Pre-v3 (legacy) reports often used `after` as the entire
      // revised passage with no `before`. We try to recover them
      // safely by extracting the part of `after` that doesn't already
      // appear in the body.
      const insertionText = resolveAdoptInsertion(body, edit);
      if (!insertionText) return body;

      // Safety: if the insertion text already appears in the body,
      // don't add it again. (Belt-and-suspenders for the case where
      // the user accepts the same edit twice, or the model's
      // insertion happens to already be in the script.)
      if (body.toLowerCase().includes(insertionText.toLowerCase())) {
        return body;
      }

      // Insert at the anchor if we have one; otherwise append to tail
      // as a last resort. The anchor path is the v3 contract.
      if (edit.before) {
        const idx = body.toLowerCase().indexOf(edit.before.toLowerCase());
        if (idx >= 0) {
          const anchorEnd = idx + edit.before.length;
          const head = body.slice(0, anchorEnd);
          const tail = body.slice(anchorEnd);
          // Ensure single space between anchor and insertion, and
          // between insertion and the rest of the body.
          const headTrimmed = head.replace(/\s+$/, "");
          const tailTrimmed = tail.replace(/^\s+/, "");
          return (
            headTrimmed +
            " " +
            insertionText.trim() +
            (tailTrimmed ? " " + tailTrimmed : "")
          );
        }
      }
      // Last-resort tail append. Only happens for legacy adopts
      // without a usable anchor.
      return body.trim() + " " + insertionText.trim();
    }
    case "rephrase": {
      if (!edit.before || !edit.after) return body;
      const idx = body.toLowerCase().indexOf(edit.before.toLowerCase());
      if (idx < 0) return body;
      return body.slice(0, idx) + edit.after + body.slice(idx + edit.before.length);
    }
    case "drill": {
      // Drill suggestions don't mutate the script; they only navigate
      // the user back to the recorder targeting a section. If a drill
      // id ends up in the apply path, no-op safely.
      return body;
    }
  }
}

// Pull the actual NEW text out of an adopt edit. Three cases:
//
//   1. v3 contract: `insertion` is set → use it directly.
//   2. Legacy with `before` set: `after` may be a full revised passage
//      that starts with `before`. Strip `before` to recover the new
//      tail. Example:
//        before    = "but here we are."
//        after     = "but here we are. Are you really sure?…"
//        insertion = "Are you really sure?…"  (recovered)
//   3. Legacy fallback: `after` may be a full revision with no clean
//      prefix match. Walk both strings token-by-token, find the
//      longest common prefix that appears in `body`, and keep only
//      what's left of `after`. If even that's empty (everything
//      already in body), return null — there's nothing to add.
function resolveAdoptInsertion(
  body: string,
  edit: { before?: string; after?: string; insertion?: string },
): string | null {
  if (edit.insertion && edit.insertion.trim()) {
    return edit.insertion.trim();
  }
  if (!edit.after || !edit.after.trim()) return null;
  const after = edit.after.trim();

  // Case 2: after starts with before — strip the prefix.
  if (edit.before) {
    const beforeNorm = edit.before.trim().toLowerCase();
    const afterLowerStart = after.toLowerCase().slice(0, beforeNorm.length);
    if (afterLowerStart === beforeNorm) {
      const remainder = after.slice(beforeNorm.length).replace(/^[\s.,;:!?]+/, "");
      return remainder ? remainder : null;
    }
  }

  // Case 3: walk word-by-word and strip whatever already appears in
  // the body. We tokenise loosely to allow for casing/punct drift.
  const bodyTokens = body.toLowerCase().split(/\s+/).filter(Boolean);
  const afterWords = after.split(/(\s+)/); // keep separators
  const afterTokens = after.toLowerCase().split(/\s+/).filter(Boolean);

  // Find the longest prefix of afterTokens that appears verbatim
  // in bodyTokens (anywhere, not just at start).
  let longestPrefix = 0;
  for (let len = afterTokens.length; len > 0; len--) {
    const slice = afterTokens.slice(0, len).join(" ");
    if (bodyTokens.join(" ").includes(slice)) {
      longestPrefix = len;
      break;
    }
  }
  if (longestPrefix === 0) return after; // nothing matched, return whole

  // Walk afterWords (which preserves whitespace) and skip the first
  // `longestPrefix` content tokens.
  let skipped = 0;
  let remainderStart = 0;
  for (let i = 0; i < afterWords.length; i++) {
    if (afterWords[i].trim() === "") continue;
    skipped += 1;
    if (skipped > longestPrefix) {
      remainderStart = i;
      break;
    }
    remainderStart = i + 1;
  }
  const remainder = afterWords.slice(remainderStart).join("").replace(/^[\s.,;:!?]+/, "");
  return remainder.trim() ? remainder.trim() : null;
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

  const { data: secRows } = await supabase
    .from("sections")
    .select("id, position, name, target_seconds, body")
    .eq("script_version_id", session.script_version_id)
    .order("position", { ascending: true });
  const recordedBodyMap = new Map<string, string>(
    (secRows ?? []).map((s) => [s.id, s.body ?? ""]),
  );
  const allEdits = mergeSuggestedEdits(
    coachEdits,
    [],
    recordedBodyMap,
  ) as unknown as SuggestedEdit[];
  // Drills don't mutate the script — they're practice actions. Filter
  // them out here so applySuggestions only handles cut/adopt/rephrase.
  // Callers wanting drill behavior route through applyDrillSuggestion
  // or applySuggestionsAndRecord, which split the picks themselves.
  const accepted = allEdits
    .filter((e) => acceptedIds.includes(e.id))
    .filter((e) => e.kind !== "drill");
  if (accepted.length === 0) {
    throw new Error("No script-mutating suggestions selected");
  }

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
//
// "Drill" edits don't mutate the script — they're practice actions.
// If the user only picked drills, we skip the version bump and route
// straight to the recorder targeting the first drill's section.
export async function applySuggestionsAndRecord(
  sessionId: string,
  acceptedIds: string[],
  practicingSectionId?: string,
): Promise<never> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("speech_id, user_id")
    .eq("id", sessionId)
    .single();
  if (!session || session.user_id !== user.id) throw new Error("Session not found");

  // Resolve which picks are drills vs. script-mutating. We need this
  // before we decide whether to bump a script version. Drills carry no
  // before/after; we look up by id against the merged edit list.
  const { drillIds, scriptEditIds, drillSectionId } =
    await classifyAcceptedEdits(supabase, sessionId, acceptedIds);

  let fromV: number | null = null;
  if (scriptEditIds.length > 0) {
    const { newVersion } = await applySuggestions(sessionId, scriptEditIds);
    fromV = newVersion;
  }

  const params = new URLSearchParams();
  if (fromV != null) params.set("from_v", String(fromV));
  if (drillIds.length > 0) params.set("drilling", "1");
  // Section targeting precedence: explicit caller arg > first drill's section.
  const targetSection = practicingSectionId ?? drillSectionId;
  if (targetSection) params.set("section", targetSection);
  // Always include the source session id so the recorder can show the
  // "Recording vN — applied edits since vN-1" banner.
  params.set("from_session", sessionId);

  redirect(`/app/speeches/${session.speech_id}/record?${params.toString()}`);
}

// Adopt an ad-hoc spoken phrase into the script as a new section
// suffix. Powers the "Better out loud" panel in Script-visible mode —
// the user clicks "Adopt into script →" on an improvised line and we
// append it to the end of the relevant section, bumping the version.
//
// We use the same body-mutation pattern as applyEditToBody's "adopt"
// case (append the spoken text). No id collision risk — we synthesize
// a one-off id local to this call.
export async function applyAdHocAdopt(
  sessionId: string,
  sectionId: string,
  spoken: string,
): Promise<{ newVersion: number }> {
  if (!spoken.trim()) throw new Error("Empty phrase");

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
  if (!sections.some((s) => s.id === sectionId)) {
    throw new Error("Section not found");
  }

  const synthetic: SuggestedEdit = {
    id: `adhoc-adopt-${sessionId}-${Date.now()}`,
    kind: "adopt",
    section_id: sectionId,
    after: spoken.trim(),
    reason: "Adopted from ad-libbed delivery.",
    provenance: "user-flag",
  };

  const editedSections = sections.map((s) => {
    if (s.id !== sectionId) return s;
    return { ...s, body: applyEditToBody(s.body, synthetic) };
  });

  const newV = speech.current_version + 1;
  await supabase.from("speeches").update({ current_version: newV }).eq("id", speech.id);

  const { data: newVer, error: insVerErr } = await supabase
    .from("script_versions")
    .insert({
      speech_id: speech.id,
      v: newV,
      summary: "Adopted an ad-libbed phrase",
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

// Drill-only flow: no script mutation. Routes the recorder to a
// specific section. Called when the user clicks "Drill →" on a single
// drill suggestion.
export async function applyDrillSuggestion(
  sessionId: string,
  drillId: string,
): Promise<never> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("speech_id, user_id")
    .eq("id", sessionId)
    .single();
  if (!session || session.user_id !== user.id) throw new Error("Session not found");

  const { drillSectionId } = await classifyAcceptedEdits(
    supabase,
    sessionId,
    [drillId],
  );

  const params = new URLSearchParams();
  params.set("drilling", "1");
  params.set("from_session", sessionId);
  if (drillSectionId) params.set("section", drillSectionId);
  redirect(`/app/speeches/${session.speech_id}/record?${params.toString()}`);
}

// Resolve the merged edit list for a session and split accepted ids by
// kind. Mirrors the read flow in applySuggestions/page.tsx so ids are
// resolved against the same view of edits the user saw.
type SbClient = Awaited<ReturnType<typeof createClient>>;
async function classifyAcceptedEdits(
  supabase: SbClient,
  sessionId: string,
  acceptedIds: string[],
): Promise<{
  drillIds: string[];
  scriptEditIds: string[];
  drillSectionId: string | null;
}> {
  const { data: report } = await supabase
    .from("ai_reports")
    .select("suggested_edits")
    .eq("session_id", sessionId)
    .maybeSingle();
  const coachEdits = (report?.suggested_edits ?? []) as unknown as SuggestedEdit[];

  const { data: secRows } = await supabase
    .from("sections")
    .select("id, body, target_seconds, position")
    .eq(
      "script_version_id",
      (
        await supabase
          .from("sessions")
          .select("script_version_id")
          .eq("id", sessionId)
          .single()
      ).data?.script_version_id ?? "",
    )
    .order("position", { ascending: true });

  const recordedBodyMap = new Map<string, string>(
    (secRows ?? []).map((s) => [s.id, s.body ?? ""]),
  );
  const allEdits = mergeSuggestedEdits(
    coachEdits,
    [],
    recordedBodyMap,
  ) as unknown as SuggestedEdit[];
  const accepted = allEdits.filter((e) => acceptedIds.includes(e.id));

  const drills = accepted.filter((e) => e.kind === "drill");
  const scriptEdits = accepted.filter((e) => e.kind !== "drill");

  return {
    drillIds: drills.map((d) => d.id),
    scriptEditIds: scriptEdits.map((s) => s.id),
    drillSectionId: drills[0]?.section_id ?? null,
  };
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
  // edits only, with overlap dedupe.
  const { data: report } = await supabase
    .from("ai_reports")
    .select("suggested_edits")
    .eq("session_id", sessionId)
    .maybeSingle();
  const coachEdits = (report?.suggested_edits ?? []) as unknown as SuggestedEdit[];

  const proposedBodyMap = new Map<string, string>(
    sections.map((s) => [s.id, s.body ?? ""]),
  );
  const allEdits = mergeSuggestedEdits(
    coachEdits,
    [],
    proposedBodyMap,
  ) as SuggestedEdit[];

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
