// Version diff page. Shows v(a) ↔ v(b) of the same speech as a track-
// changes document, reusing the same DiffDocument component the session
// report uses. The "old" version is `a`, the "new" version is `b`. So
// "skipped" rows are cuts (in v(a) but not v(b)), "improv" rows are
// additions (in v(b) but not v(a)), and "paraphrase" rows are
// rewordings.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  buildScriptDiff,
  coalesceDiff,
  type ScriptSection,
} from "@/lib/alignment";
import { DiffDocument } from "../../../../sessions/[sid]/diff-document";

type RouteParams = { id: string; a: string; b: string };

async function loadVersion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  speechId: string,
  v: number,
): Promise<{
  versionId: string;
  summary: string | null;
  sections: ScriptSection[];
  rawSections: { id: string; name: string; body: string }[];
} | null> {
  const { data: ver } = await supabase
    .from("script_versions")
    .select("id, summary")
    .eq("speech_id", speechId)
    .eq("v", v)
    .maybeSingle();
  if (!ver) return null;

  const { data: rows } = await supabase
    .from("sections")
    .select("id, position, name, target_seconds, body")
    .eq("script_version_id", ver.id)
    .order("position", { ascending: true });

  const rawSections = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    body: r.body ?? "",
  }));
  const sections: ScriptSection[] = (rows ?? []).map((r) => ({
    id: r.id,
    body: r.body ?? "",
    targetSeconds: r.target_seconds ?? 0,
    position: r.position,
  }));

  return { versionId: ver.id, summary: ver.summary, sections, rawSections };
}

export default async function VersionDiffPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { id, a, b } = await params;
  const va = parseInt(a, 10);
  const vb = parseInt(b, 10);
  if (!Number.isFinite(va) || !Number.isFinite(vb) || va === vb) notFound();

  const supabase = await createClient();
  const { data: speech } = await supabase
    .from("speeches")
    .select("id, title, current_version")
    .eq("id", id)
    .single();
  if (!speech) notFound();

  const [oldV, newV] = await Promise.all([
    loadVersion(supabase, id, va),
    loadVersion(supabase, id, vb),
  ]);
  if (!oldV || !newV) notFound();

  // The DiffDocument expects sections from the *new* version (those are
  // the headings the diff tab renders against). buildScriptDiff returns
  // diff rows tagged with the old-version section ids though, since
  // `oldSections` is passed first. We pass the new sections to the
  // component but route the diff through the old-version section ids
  // for the rowsBySection bucket — to handle that, we re-stamp the
  // section ids to the new version by position.
  const oldByPos = new Map(oldV.sections.map((s) => [s.position, s.id]));
  const newByPos = new Map(newV.sections.map((s) => [s.position, s.id]));
  const oldIdToNewId = new Map<string, string>();
  for (const [pos, oldId] of oldByPos.entries()) {
    const newId = newByPos.get(pos);
    if (newId) oldIdToNewId.set(oldId, newId);
  }

  const rawDiff = buildScriptDiff(oldV.sections, newV.sections);
  const remappedDiff = rawDiff.map((row) => {
    if (row.kind === "improv") return row;
    const sid = (row as { sectionId: string }).sectionId;
    const remapped = oldIdToNewId.get(sid) ?? sid;
    return { ...row, sectionId: remapped } as typeof row;
  });
  const diff = coalesceDiff(remappedDiff);

  const sectionList = newV.rawSections.map((s) => ({ id: s.id, name: s.name }));
  const scriptBodies: Record<string, string> = Object.fromEntries(
    newV.rawSections.map((s) => [s.id, s.body]),
  );

  // Counts for the header.
  let cuts = 0;
  let additions = 0;
  let paraphrases = 0;
  for (const row of diff) {
    if (row.kind === "skipped") cuts += 1;
    else if (row.kind === "improv") additions += 1;
    else if (row.kind === "paraphrase") paraphrases += 1;
  }

  return (
    <div>
      <Link
        href={`/app/speeches/${id}`}
        className="text-body-sm"
        style={{ color: "var(--color-muted-ash)" }}
      >
        ← {speech.title}
      </Link>
      <h1 className="text-heading-lg mt-3">
        v{va} → v{vb}
      </h1>
      <p
        className="text-body mt-2"
        style={{ color: "var(--color-muted-ash)" }}
      >
        Track-changes view of what changed between these two drafts.
      </p>

      <div
        className="flex gap-3 mt-4"
        style={{ flexWrap: "wrap" }}
      >
        <span className="badge pill-soft">
          v{va}
          {oldV.summary ? ` · ${oldV.summary}` : ""}
        </span>
        <span className="badge pill-soft">
          v{vb}
          {newV.summary ? ` · ${newV.summary}` : ""}
        </span>
        <span
          className="text-caption"
          style={{ color: "var(--color-muted-ash)" }}
        >
          {cuts} cut{cuts === 1 ? "" : "s"} · {additions} addition
          {additions === 1 ? "" : "s"} · {paraphrases} reword
          {paraphrases === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-8">
        <DiffDocument
          diff={diff}
          sections={sectionList}
          mode="with-script"
          scriptBodies={scriptBodies}
        />
      </div>
    </div>
  );
}
