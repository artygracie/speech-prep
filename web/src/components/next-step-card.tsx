// NextStepCard — a single-recommendation surface used on the speech
// detail page and the session report. Renders a headline, a short
// rationale, and a primary action button, plus an "I want to do
// something else" link that drops the user back into the generic
// /record page.
//
// Server component. Takes a precomputed Recommendation and a speechId
// for the override fallback. Keeps presentation rules in one place so
// the same card looks consistent everywhere.

import Link from "next/link";
import type { Recommendation } from "@/lib/lifecycle";

export function NextStepCard({
  recommendation,
  speechId,
  variant = "primary",
}: {
  recommendation: Recommendation;
  speechId: string;
  // primary  — large headline, used at the top of the speech detail page
  // compact  — smaller, used at the bottom of session reports
  variant?: "primary" | "compact";
}) {
  const isPrimary = variant === "primary";
  return (
    <section
      data-recommendation-phase={recommendation.phase}
      style={{
        background: "var(--color-canvas-white)",
        borderRadius: 14,
        border: "1px solid rgba(17,17,17,0.08)",
        padding: isPrimary ? "24px 28px" : "18px 22px",
        boxShadow: isPrimary
          ? "0 1px 0 rgba(17,17,17,0.04), 0 8px 24px -16px rgba(17,17,17,0.12)"
          : "none",
      }}
    >
      <div
        className="text-caption"
        style={{
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-muted-ash)",
          fontSize: 11,
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        Next step
      </div>
      <h2
        style={{
          fontFamily: "var(--font-script)",
          fontSize: isPrimary ? 26 : 20,
          fontWeight: 500,
          lineHeight: 1.2,
          letterSpacing: "-0.012em",
          color: "var(--color-midnight-ink)",
          margin: 0,
        }}
      >
        {recommendation.headline}
      </h2>
      <p
        className="text-body mt-2"
        style={{
          color: "var(--color-muted-ash)",
          maxWidth: 560,
          marginTop: 6,
        }}
      >
        {recommendation.rationale}
      </p>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: isPrimary ? 18 : 14,
        }}
      >
        <Link
          href={recommendation.primaryAction.href}
          className="btn-primary"
          data-recommendation-action="primary"
        >
          {recommendation.primaryAction.label}
        </Link>
        {recommendation.phase !== "needs_script" && (
          <Link
            href={`/app/speeches/${speechId}/record`}
            className="text-body-sm"
            style={{
              color: "var(--color-muted-ash)",
              textDecoration: "underline",
              textUnderlineOffset: 4,
            }}
            data-recommendation-action="override"
          >
            Or record something else
          </Link>
        )}
      </div>
    </section>
  );
}
