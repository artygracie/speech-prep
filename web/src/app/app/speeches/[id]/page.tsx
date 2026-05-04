// Speech detail. Reads the speech + its current sections from the
// `current_script` view (joins through current_version automatically).

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default async function SpeechDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: speech } = await supabase
    .from("speeches")
    .select("id, title, occasion, current_version, created_at")
    .eq("id", id)
    .single();
  if (!speech) notFound();

  const { data: scriptRows } = await supabase
    .from("current_script")
    .select("section_id, position, section_name, target_seconds, body")
    .eq("speech_id", id)
    .order("position", { ascending: true });

  const sections = scriptRows ?? [];
  const targetTotal = sections.reduce((a, s) => a + (s.target_seconds ?? 0), 0);
  const totalWords = sections.reduce(
    (a, s) => a + (s.body?.split(/\s+/).filter(Boolean).length ?? 0),
    0,
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "end",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div>
          <Link href="/app" className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            ← Speeches
          </Link>
          <h1 className="text-heading-lg mt-3">{speech.title}</h1>
          <div className="flex items-center gap-3 mt-3">
            <span className="badge pill-soft">
              <span className="dot" />
              {speech.occasion ?? "Speech"}
            </span>
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              v{speech.current_version} · target {fmtTime(targetTotal)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/app/speeches/${speech.id}/edit`} className="btn-light">
            Edit script
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-10 mt-10">
        <div className="lg:col-span-7">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading">Script</h2>
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              {sections.length} {sections.length === 1 ? "section" : "sections"} · {totalWords} words
            </span>
          </div>

          <article
            className="mt-6"
            style={{
              background: "var(--color-canvas-white)",
              borderRadius: 12,
              border: "1px solid rgba(17,17,17,0.06)",
              padding: "8px 36px 36px",
            }}
          >
            {sections.map((sec, i) => (
              <section
                key={sec.section_id}
                style={{
                  padding: "28px 0 8px",
                  borderTop: i === 0 ? "0" : "1px solid rgba(17,17,17,0.06)",
                }}
              >
                <header
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 16,
                    marginBottom: 14,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--color-muted-ash)",
                    }}
                  >
                    {sec.section_name}
                  </h3>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--color-muted-ash)",
                    }}
                  >
                    Target {fmtTime(sec.target_seconds ?? 0)}
                  </span>
                </header>
                <p
                  style={{
                    fontFamily: "var(--font-script)",
                    fontSize: 18,
                    lineHeight: 1.65,
                    color: "var(--color-midnight-ink)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {sec.body || (
                    <span style={{ color: "var(--color-muted-ash)", fontStyle: "italic" }}>
                      (empty section)
                    </span>
                  )}
                </p>
              </section>
            ))}
          </article>
        </div>

        <div className="lg:col-span-5">
          <h2 className="text-heading">Sessions</h2>
          <p className="text-body mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Recording lands in Phase 2. For now, edit the script and watch your version history
            grow.
          </p>
          <div className="empty-state mt-5">
            <p className="text-subheading">Coming soon.</p>
            <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
              Real audio capture, transcription, pacing reports, and the said-vs-written diff are
              the next phase.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
