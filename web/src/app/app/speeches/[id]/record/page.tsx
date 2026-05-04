// Recording page. RSC fetches the speech + sections; the actual capture
// is delegated to the Recorder client component, which talks to the
// session-related server actions.

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Recorder } from "./recorder";

export default async function RecordPage({
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

  const sections = (scriptRows ?? []).map((s) => ({
    id: s.section_id ?? "",
    position: s.position ?? 0,
    name: s.section_name ?? "Untitled",
    targetSec: s.target_seconds ?? 30,
    body: s.body ?? "",
  }));

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "end", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <Link href={`/app/speeches/${speech.id}`} className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            ← Back to {speech.title}
          </Link>
          <h1 className="text-heading-lg mt-3">{speech.title}</h1>
          <div className="text-caption mt-3" style={{ color: "var(--color-muted-ash)" }}>
            Recording v{speech.current_version}
          </div>
        </div>
      </div>

      <Recorder speechId={speech.id} sections={sections} />
    </div>
  );
}
