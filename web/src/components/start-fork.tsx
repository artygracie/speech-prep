// StartFork — the two doors into a new speech. Nothing else belongs on
// this surface: no fields, no explainers. One question, two answers.
//
//   "Need help writing it?"  → the AI writer
//   "Already written?"       → the upload-first intake
//
// Used by /app/speeches/start (returning users) and the first-run
// onboarding fork. Pure links / callbacks so it can be a server or
// client child.

import Link from "next/link";

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "28px 24px",
  border: "1px solid rgba(17,17,17,0.1)",
  borderRadius: 14,
  background: "var(--color-canvas-white)",
  textDecoration: "none",
  color: "var(--color-midnight-ink)",
  transition: "border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease",
};

function CardBody({
  title,
  sub,
  cta,
}: {
  title: string;
  sub: string;
  cta: string;
}) {
  return (
    <>
      <span className="text-heading-sm" style={{ fontWeight: 600 }}>
        {title}
      </span>
      <span
        className="text-body-sm"
        style={{ color: "var(--color-muted-ash)", lineHeight: 1.55, flex: 1 }}
      >
        {sub}
      </span>
      <span className="text-body-sm mt-2" style={{ fontWeight: 500 }}>
        {cta}
      </span>
    </>
  );
}

export function StartFork({
  writeHref,
  uploadHref,
  onUpload,
}: {
  writeHref: string;
  /** Link target for the upload door… */
  uploadHref?: string;
  /** …or a click handler when the parent swaps steps in place (onboarding). */
  onUpload?: () => void;
}) {
  const write = (
    <CardBody
      title="Need help writing it?"
      sub="Answer a few questions, get a real first draft. You make it yours."
      cta="Start writing →"
    />
  );
  const upload = (
    <CardBody
      title="Already written?"
      sub="Drop in the doc. We'll read it, time it, and have you rehearsing in under a minute."
      cta="Upload my speech →"
    />
  );

  return (
    <div
      className="start-fork"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 16,
      }}
    >
      <Link href={writeHref} style={cardStyle} className="start-fork-card">
        {write}
      </Link>
      {onUpload ? (
        <button
          type="button"
          onClick={onUpload}
          style={{ ...cardStyle, textAlign: "left", cursor: "pointer", font: "inherit" }}
          className="start-fork-card"
        >
          {upload}
        </button>
      ) : (
        <Link href={uploadHref ?? "/app/speeches/new"} style={cardStyle} className="start-fork-card">
          {upload}
        </Link>
      )}
    </div>
  );
}
