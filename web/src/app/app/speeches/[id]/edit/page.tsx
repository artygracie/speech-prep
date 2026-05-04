// Editor page. Reads the current sections server-side, then hands off to
// the client editor which manages local block state and calls the save
// server action when the user hits Save.

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScriptEditor } from "./editor";

export default async function EditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: speech } = await supabase
    .from("speeches")
    .select("id, title, current_version")
    .eq("id", id)
    .single();
  if (!speech) notFound();

  const { data: scriptRows } = await supabase
    .from("current_script")
    .select("section_id, position, section_name, target_seconds, body")
    .eq("speech_id", id)
    .order("position", { ascending: true });

  if (!scriptRows || scriptRows.length === 0) {
    // No sections yet — shouldn't happen, but cover it. Send back to detail.
    redirect(`/app/speeches/${id}`);
  }

  return (
    <ScriptEditor
      speechId={speech.id}
      title={speech.title}
      currentVersion={speech.current_version}
      sections={scriptRows.map((s) => ({
        id: s.section_id ?? "",
        name: s.section_name ?? "Untitled",
        targetSec: s.target_seconds ?? 30,
        body: s.body ?? "",
      }))}
    />
  );
}
