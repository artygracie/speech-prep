// Landing page. The full marketing surface from the static demo lives in
// the project root's index.html; this is the production replacement, ported
// piece by piece. For Phase 1 we ship the hero, premise, how-it-works,
// pricing, and footer — enough to drive sign-ups. The longer-tail sections
// (features grid, FAQ, evidence) come back in a follow-up.

import Image from "next/image";
import Link from "next/link";
import { LiveTranscript } from "./_landing/live-transcript";

export default function LandingPage() {
  return (
    <>
      {/* ===== Sticky nav ===== */}
      <header
        className="sticky top-0 z-50"
        style={{
          // Glassy: low opacity, strong blur + saturation, hairline shadow.
          // The translucent bg + saturate boost lets the gradient bleed through.
          background: "rgba(255, 255, 255, 0.55)",
          backdropFilter: "saturate(180%) blur(18px)",
          WebkitBackdropFilter: "saturate(180%) blur(18px)",
          borderBottom: "1px solid rgba(17, 17, 17, 0.04)",
          boxShadow: "0 1px 0 rgba(255, 255, 255, 0.5) inset",
        }}
      >
        <div className="container-x flex items-center justify-between py-3.5">
          <Link href="/" aria-label="SpeechPrep — home" className="flex items-center">
            <Image
              src="/assets/logo-wordmark-dark.png"
              alt="SpeechPrep"
              width={160}
              height={24}
              priority
              style={{ height: 24, width: "auto", display: "block" }}
            />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <a href="#how" className="nav-link">How it works</a>
            <a href="#pricing" className="nav-link">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost hidden sm:inline-flex">Open app</Link>
            <Link href="/login" className="btn-primary">Begin</Link>
          </div>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        <div className="hero-bg" aria-hidden="true" />
        <div className="container-x relative z-10 pt-24 pb-24 md:pt-32 md:pb-28">
          <div className="max-w-4xl">
            {/* Eyebrow as a soft pill — sits a touch off the page so the
                eye lands on it before the headline. */}
            <span
              className="text-caption"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(255, 255, 255, 0.65)",
                backdropFilter: "saturate(160%) blur(8px)",
                WebkitBackdropFilter: "saturate(160%) blur(8px)",
                border: "1px solid rgba(17, 17, 17, 0.06)",
                color: "var(--color-midnight-ink)",
                padding: "6px 12px",
                borderRadius: 999,
                boxShadow: "0 1px 2px rgba(17, 17, 17, 0.04)",
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
              Practice your speech before you give it
            </span>
            <h1 className="text-display mt-7">
              The room before
              <br />
              {/* "the" set in italic Instrument Serif — the page's accent
                  face. The italic alone carries the emphasis; underline
                  treatment was overkill. */}
              <span
                className="serif"
                style={{
                  fontStyle: "italic",
                  fontWeight: 400,
                  fontSize: "1.15em",
                  letterSpacing: "-0.04em",
                  marginRight: "0.06em",
                }}
              >
                the
              </span>{" "}
              room.
            </h1>
            <p
              className="mt-8 text-body md:text-subheading max-w-xl"
              style={{ color: "var(--color-muted-ash)" }}
            >
              Upload the speech. Record yourself giving it. SpeechPrep tells you, to the second,
              which sections ran long &mdash; which lines you skipped &mdash; and which off-script
              moments were better than what you wrote down.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5 max-w-lg">
              <Link href="/login" className="btn-primary">
                Start practicing &rarr;
              </Link>
              <Link
                href="#how"
                className="text-body-sm"
                style={{
                  color: "var(--color-muted-ash)",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                  textDecorationColor: "rgba(17,17,17,0.18)",
                }}
              >
                How it works
              </Link>
            </div>
            <p className="mt-4 text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              Three sessions free. Then $12 a month, or $19 once.
            </p>
          </div>

          {/* Live recording mockup — interactive */}
          <LiveTranscript />
        </div>
      </section>

      {/* ===== Premise ===== */}
      <section className="py-28 md:py-36">
        <div className="container-narrow">
          <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            The premise
          </span>
          <h2 className="text-heading-lg mt-5">
            Most people prepare a speech in a Google Doc and read it aloud twice. Then they go and
            give it.{" "}
            <span className="serif" style={{ color: "var(--color-phoenix-orange)" }}>
              That&rsquo;s the whole rehearsal.
            </span>
          </h2>
          <div
            className="mt-10 grid md:grid-cols-2 gap-x-12 gap-y-6 text-body"
            style={{ color: "var(--color-muted-ash)", maxWidth: 720 }}
          >
            <p>
              Practice happens to nobody. Nothing is timed. Nothing is compared to the script. The
              lines you keep cutting on the day &mdash; you cut them in rehearsal too. You just
              didn&rsquo;t notice.
            </p>
            <p>
              And the speech you wrote and the speech you actually give are two different documents
              that never meet. By the third pass, the room has the second draft in its head and the
              script still has the first.
            </p>
          </div>
          <p className="mt-10 text-heading" style={{ maxWidth: 720 }}>
            SpeechPrep makes the rehearsal <span className="underline-wavy">measurable</span>, and
            lets the script keep up.
          </p>
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section id="how" className="py-24 md:py-32 surface-whisper">
        <div className="container-x">
          <div className="grid md:grid-cols-12 gap-10">
            <div className="md:col-span-4">
              <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                How it works
              </span>
              <h2 className="text-heading-lg mt-5">A rehearsal, captured.</h2>
              <p className="text-body mt-5" style={{ color: "var(--color-muted-ash)" }}>
                You don&rsquo;t change how you practice. We just sit in the corner with a stopwatch
                and a transcript.
              </p>
            </div>

            <div className="md:col-span-8 space-y-3">
              {[
                {
                  n: "01",
                  title: "Drop in the speech.",
                  body:
                    "Paste it, upload a doc, or import from Drive. Either mark the sections yourself, or let us read it once and propose them.",
                },
                {
                  n: "02",
                  title: "Give the speech.",
                  body:
                    "In a teleprompter, or freestyle. Tap a key when something lands, when something falls flat, when you lose your place. We listen, we time, we transcribe.",
                },
                {
                  n: "03",
                  title: "Read what came back.",
                  body:
                    "A per-section pacing report. A diff between what you wrote and what you said. A handful of specific notes — not 'speak with confidence,' but specific lines to cut, keep, or rewrite.",
                },
                {
                  n: "04",
                  title: "Update the script.",
                  body:
                    "Accept the ad-libs that worked. The script becomes a living version of the speech — not the one you wrote on Monday, the one you actually want to give on Saturday.",
                },
              ].map((step) => (
                <article
                  key={step.n}
                  className="card-bordered p-7 grid md:grid-cols-12 gap-6 items-start"
                >
                  <div
                    className="md:col-span-1"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: 36,
                      lineHeight: 1,
                      color: "var(--color-muted-ash)",
                      opacity: 0.5,
                    }}
                  >
                    {step.n}
                  </div>
                  <div className="md:col-span-11">
                    <h3 className="text-heading-sm">{step.title}</h3>
                    <p className="text-body mt-2" style={{ color: "var(--color-muted-ash)" }}>
                      {step.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section
        id="pricing"
        className="py-28 surface-whisper border-t border-[rgba(17,17,17,0.06)]"
      >
        <div className="container-x">
          <div className="max-w-2xl">
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              Pricing
            </span>
            <h2 className="text-heading-lg mt-5">
              Three free sessions. Then it depends on you.
            </h2>
            <p
              className="text-body mt-5"
              style={{ color: "var(--color-muted-ash)", maxWidth: 560 }}
            >
              One session shows you the timing. Three show you the convergence. We give you all
              three before asking for anything.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-5 mt-14">
            <PricingCard
              name="Free"
              price="$0"
              cadence=""
              tagline="Three sessions, on the house"
              cta="Begin"
              ctaHref="/login"
              dark={false}
              right="Start here"
              features={[
                "Three full sessions",
                "Speeches up to five minutes",
                "Section pacing report",
                "Said-vs-written diff",
                "Audio recording",
              ]}
            />
            <PricingCard
              name="Practiced"
              price="$12"
              cadence="/ month"
              tagline="Or $96 a year — two months free"
              cta="Subscribe"
              ctaHref="/login"
              dark={true}
              right="For repeat speakers"
              features={[
                "Unlimited sessions",
                "Speeches up to sixty minutes",
                "Audio and video",
                "Live keypress tagging",
                "Iterative script versioning",
                "Trends across speeches",
                "PDF export and share links",
              ]}
            />
            <PricingCard
              name="Single speech"
              price="$19"
              cadence="once"
              tagline="Seven days, one speech, no card after"
              cta="Buy the pass"
              ctaHref="/login"
              dark={false}
              right="One-time pass"
              features={[
                "Unlimited sessions for a week",
                "Everything in Practiced",
                "One speech, locked in",
                "No subscription, no auto-renew",
                "We delete the recording after, if you want",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="pb-16 surface-canvas">
        <div className="container-x pt-12 border-t border-[rgba(17,17,17,0.1)] grid md:grid-cols-12 gap-10">
          <div className="md:col-span-5">
            <Image
              src="/assets/logo-wordmark-dark.png"
              alt="SpeechPrep"
              width={170}
              height={26}
              style={{ height: 26, width: "auto", display: "block" }}
            />
            <p
              className="text-body mt-5 max-w-xs"
              style={{ color: "var(--color-muted-ash)" }}
            >
              The rehearsal room for people who actually rehearse.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="text-caption mb-4" style={{ color: "var(--color-muted-ash)" }}>
              Product
            </div>
            <ul className="space-y-2.5 text-body-sm">
              <li>
                <a href="#how" style={{ color: "var(--color-midnight-ink)" }}>
                  How it works
                </a>
              </li>
              <li>
                <a href="#pricing" style={{ color: "var(--color-midnight-ink)" }}>
                  Pricing
                </a>
              </li>
            </ul>
          </div>
          <div className="md:col-span-3">
            <div className="text-caption mb-4" style={{ color: "var(--color-muted-ash)" }}>
              Company
            </div>
            <ul className="space-y-2.5 text-body-sm">
              <li>
                <a href="mailto:hello@speechprep.ai" style={{ color: "var(--color-midnight-ink)" }}>
                  hello@speechprep.ai
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div
          className="container-x mt-12 flex flex-col md:flex-row justify-between gap-3 text-caption"
          style={{ color: "var(--color-muted-ash)" }}
        >
          <span>&copy; 2026 SpeechPrep</span>
          <span className="serif" style={{ fontStyle: "italic", fontSize: 13 }}>
            made for the room before the room
          </span>
        </div>
      </footer>
    </>
  );
}

function PricingCard({
  name,
  price,
  cadence,
  tagline,
  cta,
  ctaHref,
  dark,
  features,
  right,
}: {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  cta: string;
  ctaHref: string;
  dark: boolean;
  features: string[];
  right: string;
}) {
  return (
    <div
      className={`p-8 flex flex-col ${dark ? "" : "card-bordered"}`}
      style={
        dark
          ? {
              background: "var(--color-midnight-ink)",
              color: "var(--color-canvas-white)",
              borderRadius: 12,
            }
          : undefined
      }
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-heading-sm">{name}</h3>
        <span
          className="text-caption"
          style={dark ? { opacity: 0.6 } : { color: "var(--color-muted-ash)" }}
        >
          {right}
        </span>
      </div>
      <div className="mt-7 flex items-baseline gap-1.5">
        <span
          className="num"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 72,
            lineHeight: 1,
          }}
        >
          {price}
        </span>
        {cadence && (
          <span
            className="text-body-sm"
            style={dark ? { opacity: 0.6 } : { color: "var(--color-muted-ash)" }}
          >
            {cadence}
          </span>
        )}
      </div>
      <p
        className="text-body-sm mt-1"
        style={dark ? { opacity: 0.6 } : { color: "var(--color-muted-ash)" }}
      >
        {tagline}
      </p>
      <ul className="mt-8 space-y-3 text-body-sm" style={{ minHeight: 188 }}>
        {features.map((f) => (
          <li key={f} className="flex gap-3">
            <span style={dark ? { opacity: 0.5 } : { color: "var(--color-muted-ash)" }}>
              &mdash;
            </span>
            {f}
          </li>
        ))}
      </ul>
      <Link
        href={ctaHref}
        className={dark ? "" : "btn-light"}
        style={
          dark
            ? {
                marginTop: "auto",
                textAlign: "center",
                background: "var(--color-canvas-white)",
                color: "var(--color-midnight-ink)",
                borderRadius: 8,
                padding: "13px 20px",
                fontWeight: 500,
                fontSize: 15,
              }
            : { marginTop: "auto", textAlign: "center" }
        }
      >
        {cta}
      </Link>
    </div>
  );
}
