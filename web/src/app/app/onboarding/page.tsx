// First-run welcome. Renders outside the sidenav shell so the page is a
// single, focused intake screen — title + speech body + one CTA. Submits
// to `createFirstSpeech`, which auto-sections and redirects straight to
// the recorder with `?firstRun=1` so the recorder shows its coach-mark.
//
// We intentionally do NOT gate this route on first-run state. Users can
// hit /app/onboarding any time they want a no-friction "new speech and
// straight to record" path. The dashboard's redirect-on-empty just makes
// sure first-time users land here automatically.

import Image from "next/image";
import Link from "next/link";
import { createFirstSpeech } from "../actions";
import { OnboardingStart } from "./onboarding-start";

export const metadata = { title: "Welcome — SpeechPrep" };

export default function OnboardingPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-canvas-white)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "20px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/" aria-label="SpeechPrep — home" style={{ display: "inline-flex" }}>
          <Image
            src="/assets/logo-wordmark-dark.png"
            alt="SpeechPrep"
            width={150}
            height={22}
            style={{ height: 22, width: "auto" }}
            priority
          />
        </Link>
        <Link
          href="/app"
          className="text-body-sm"
          style={{ color: "var(--color-muted-ash)" }}
        >
          Skip for now
        </Link>
      </header>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "32px 24px 80px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 720 }}>
          <span
            className="text-caption"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid rgba(17,17,17,0.08)",
              color: "var(--color-midnight-ink)",
              padding: "5px 10px",
              borderRadius: 999,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "var(--color-phoenix-orange)",
                display: "inline-block",
              }}
            />
            Your first full rehearsal is free
          </span>

          <h1 className="text-display mt-6">
            Welcome.{" "}
            <span
              className="serif"
              style={{
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: "1.05em",
                letterSpacing: "-0.02em",
              }}
            >
              Let&rsquo;s
            </span>{" "}
            get the first one in the bag.
          </h1>
          <p
            className="text-body mt-5"
            style={{ color: "var(--color-muted-ash)", maxWidth: 560 }}
          >
            Give it a real run — the full coach report comes back on the house.
          </p>

          <div className="mt-10">
            <OnboardingStart action={createFirstSpeech} />
          </div>
        </div>
      </div>
    </main>
  );
}
