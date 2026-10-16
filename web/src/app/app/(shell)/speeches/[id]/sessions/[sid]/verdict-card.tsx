// The "Am I ready?" card at the top of a session report: a one-line
// verdict, the three checks it rests on, and the one thing to do next.
// The coach's prose and the marked-up script sit below it for anyone
// who wants the detail.
//
// Server component. The verdict comes from lib/readiness; the next step
// is the lifecycle recommendation, which only exists once the coach has
// finished, so the card renders without it until then.

import Link from "next/link";
import type { Readiness, Verdict } from "@/lib/readiness";
import type { Recommendation } from "@/lib/lifecycle";

const EYEBROW: Record<Verdict, string> = {
  ready: "Ready",
  close: "Almost there",
  "not-yet": "Not yet",
};

const PILL: Record<Verdict, string> = {
  ready: "pill-mint",
  close: "pill-gold",
  "not-yet": "pill-red",
};

export function VerdictCard({
  readiness,
  recommendation,
}: {
  readiness: Readiness;
  recommendation: Recommendation | null;
}) {
  return (
    <section
      className="card-bordered"
      data-verdict={readiness.verdict}
      style={{ padding: "24px 28px", maxWidth: 780 }}
    >
      <span className={`badge ${PILL[readiness.verdict]}`}>
        <span className="dot" />
        Am I ready? · {EYEBROW[readiness.verdict]}
      </span>
      <h2
        style={{
          fontFamily: "var(--font-script)",
          fontSize: 26,
          fontWeight: 500,
          lineHeight: 1.2,
          letterSpacing: "-0.012em",
          color: "var(--color-midnight-ink)",
          margin: "14px 0 0",
        }}
      >
        {readiness.headline}
      </h2>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          margin: "20px 0 0",
        }}
      >
        {readiness.checks.map((c) => (
          <div key={c.key} data-check={c.key} data-status={c.status}>
            <dt className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              {c.label}
            </dt>
            <dd style={{ margin: "4px 0 0" }}>
              <span
                className="num"
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: c.status === "good" ? "var(--color-midnight-ink)" : "var(--color-leadgen-red)",
                }}
              >
                {c.value}
              </span>
              <p className="text-body-sm" style={{ margin: "4px 0 0", color: "var(--color-muted-ash)" }}>
                {c.detail}
              </p>
            </dd>
          </div>
        ))}
      </dl>

      {recommendation && (
        <div
          style={{
            marginTop: 20,
            paddingTop: 18,
            borderTop: "1px solid rgba(17,17,17,0.08)",
            display: "flex",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              Next
            </div>
            <p className="text-body" style={{ margin: "4px 0 0", fontWeight: 600 }}>
              {recommendation.headline}
            </p>
            <p className="text-body-sm" style={{ margin: "4px 0 0", color: "var(--color-muted-ash)" }}>
              {recommendation.rationale}
            </p>
          </div>
          <Link href={recommendation.primaryAction.href} className="btn-primary">
            {recommendation.primaryAction.label}
          </Link>
        </div>
      )}
    </section>
  );
}
