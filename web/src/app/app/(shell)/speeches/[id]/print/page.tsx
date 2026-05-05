// Print-friendly view of the current script. Big serif body, clear
// section headings + target times, page breaks between sections so
// the user can spread their notes across multiple pages on a podium.
//
// Hits the browser's native print dialog on mount — the user can save
// as PDF from there. No external library, no new dependency.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintTrigger, PrintButton } from "./print-trigger";

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default async function PrintScriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: speech } = await supabase
    .from("speeches")
    .select("id, title, occasion, current_version")
    .eq("id", id)
    .single();
  if (!speech) notFound();

  const { data: rows } = await supabase
    .from("current_script")
    .select("section_id, position, section_name, target_seconds, body")
    .eq("speech_id", id)
    .order("position", { ascending: true });
  const sections = rows ?? [];
  const targetTotal = sections.reduce(
    (a, s) => a + (s.target_seconds ?? 0),
    0,
  );

  return (
    <div className="print-root">
      <PrintTrigger />
      <style>{`
        @page {
          margin: 0.6in 0.7in;
        }
        .print-root {
          background: white;
          color: #111;
          padding: 8px 0;
        }
        .print-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .print-doc {
          max-width: 720px;
          margin: 0 auto;
          padding: 0 16px;
        }
        .print-section {
          page-break-inside: avoid;
          break-inside: avoid;
          padding: 24px 0 8px;
          border-top: 1px solid rgba(17,17,17,0.12);
        }
        .print-section:first-child { border-top: 0; }
        .print-section-h {
          display: flex; justify-content: space-between; align-items: baseline;
          gap: 12px;
          margin-bottom: 10px;
        }
        .print-section-name {
          font-size: 13px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #666;
          font-weight: 500;
        }
        .print-section-time {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #888;
        }
        .print-body {
          font-family: var(--font-script, Georgia, serif);
          font-size: 18px;
          line-height: 1.7;
          white-space: pre-wrap;
        }
        @media print {
          .no-print { display: none !important; }
          .print-doc { max-width: none; padding: 0; }
        }
      `}</style>

      <div className="print-doc">
        <div className="print-toolbar no-print">
          <Link
            href={`/app/speeches/${speech.id}`}
            style={{ color: "#666", textDecoration: "none", fontSize: 13 }}
          >
            ← Back
          </Link>
          <PrintButton />
        </div>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: "0 0 6px",
          }}
        >
          {speech.title}
        </h1>
        <div style={{ color: "#777", fontSize: 13 }}>
          {speech.occasion ? `${speech.occasion} · ` : ""}
          v{speech.current_version} · target {fmtTime(targetTotal)}
        </div>

        <article style={{ marginTop: 24 }}>
          {sections.map((s) => (
            <section key={s.section_id} className="print-section">
              <header className="print-section-h">
                <h3 className="print-section-name">{s.section_name}</h3>
                <span className="print-section-time">
                  Target {fmtTime(s.target_seconds ?? 0)}
                </span>
              </header>
              <p className="print-body">{s.body || "(empty section)"}</p>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
