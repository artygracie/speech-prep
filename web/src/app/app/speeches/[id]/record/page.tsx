// Recording page. RSC fetches the speech + sections; the actual capture
// is delegated to the Recorder client component, which owns the layout
// (two-column: script on the left, recording sidebar on the right).

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
      {/* Tight header — back link + title + version, all on one line.
          We give as much vertical space as possible to the recorder. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <Link
            href={`/app/speeches/${speech.id}`}
            className="text-body-sm"
            style={{ color: "var(--color-muted-ash)" }}
          >
            ←
          </Link>
          <h1
            style={{
              fontFamily: "var(--font-script)",
              fontSize: 22,
              lineHeight: 1.2,
              fontWeight: 500,
              letterSpacing: "-0.012em",
            }}
          >
            {speech.title}
          </h1>
          <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            v{speech.current_version}
          </span>
        </div>
      </div>

      <Recorder
        speechId={speech.id}
        sections={sections}
      />
    </div>
  );
}
