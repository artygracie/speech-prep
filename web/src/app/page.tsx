// Landing page.
//
// The page has one job: get a nervous best man to read a speech out loud
// right now. So the demo is not linked from the hero, it IS the hero. The
// real product, running, replaced the scripted LiveTranscript mock that used
// to sit there; that component was deleted with it, since nothing else
// rendered it.
//
// Everything below the hero is footnotes to that: what comes back, who
// it's for, what it costs, the questions people ask. Four sections, each
// with its own structure, so the page has a shape instead of a rhythm.
//
// Arty UI discipline: btn-primary is ink, never the accent. The accent
// appears exactly three times on this page: the eyebrow dot, one wavy
// underline, one .hl tint. One Sentient italic word per headline, on the
// word carrying the meaning. No em-dashes anywhere in copy.

import Image from "next/image";
import Link from "next/link";
import { DemoClient } from "./demo/demo-client";
import { ROLES } from "@/lib/roles";
import { SITE_URL } from "@/lib/site";

// ---------------------------------------------------------------------------
// Copy that renders AND feeds structured data, so the two can't drift.
// ---------------------------------------------------------------------------

const FAQS = [
  {
    q: "What is SpeechPrep?",
    a: "A rehearsal tool. You read your speech out loud, it listens, and it gives you the timing of each section, a comparison of what you said against what you wrote, and one thing to fix before the next run.",
  },
  {
    q: "Is it free?",
    a: "The sample speech on this page is free to try with no account. Your first full rehearsal on your own speech is also free, with the complete report and no card. After that the Event Pass is $24 one time for a month of unlimited rehearsals on that speech. Repeat speakers can subscribe to Practiced for $12 a month.",
  },
  {
    q: "What kinds of speeches does it work for?",
    a: "Any speech with a written script. It is built around wedding speeches: best man, maid of honor, father of the bride, mother of the groom. It works the same way for a pitch, a talk, or a eulogy.",
  },
  {
    q: "How is it different from other speech apps?",
    a: "Most give general delivery feedback, like pace and filler words. SpeechPrep works from your script. It times each section, marks every line you changed or dropped, and ties its notes to your exact words.",
  },
];

const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "SpeechPrep",
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Read your speech out loud once and see the timing of each section, the lines you skipped, and one thing to fix. Built for wedding speeches.",
  offers: [
    {
      "@type": "Offer",
      price: "24",
      priceCurrency: "USD",
      description:
        "Event Pass, $24 once. One speech, unlimited rehearsals and coaching for 30 days. No subscription.",
    },
    {
      "@type": "Offer",
      price: "12",
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "12",
        priceCurrency: "USD",
        unitCode: "MON",
      },
      description:
        "Practiced, $12 a month. Unlimited rehearsals across every speech, script versioning, memory recall maps.",
    },
    {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description:
        "First full rehearsal free, with the complete coach report. No card.",
    },
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

const WHAT_COMES_BACK = [
  {
    term: "Timing, section by section",
    detail:
      "How long each part took against how long it is written to run. It is usually the story that runs long.",
  },
  {
    term: "What you said against what you wrote",
    detail:
      "Every line you dropped, changed, or added, marked on the script. Some of what you changed will be better than the script. Keep those.",
  },
  {
    term: "One thing to fix",
    detail:
      "The single change that will do the most for the next run, and why. The full breakdown is there when you want it.",
  },
];

const muted = { color: "var(--color-muted-ash)" } as const;

// ---------------------------------------------------------------------------

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {/* Nav. Plain white with a hairline, not glass. */}
      <header
        className="sticky top-0 z-50"
        style={{
          background: "var(--color-canvas-white)",
          borderBottom: "1px solid rgba(17, 17, 17, 0.08)",
        }}
      >
        <div className="container-x flex items-center justify-between py-3.5">
          <Link href="/" aria-label="SpeechPrep home" className="flex items-center">
            <Image
              src="/assets/logo-wordmark-dark.png"
              alt="SpeechPrep"
              width={150}
              height={22}
              priority
              style={{ height: 22, width: "auto", display: "block" }}
            />
          </Link>
          <nav className="flex items-center gap-1">
            <a href="#pricing" className="nav-link hidden md:inline-flex">
              Pricing
            </a>
            <Link href="/login" className="nav-link">
              Sign in
            </Link>
            <a href="#try" className="btn-primary" style={{ marginLeft: 8 }}>
              Try it
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: the demo is the hero. */}
        <section className="relative overflow-hidden">
          <div className="hero-bg" aria-hidden="true" />
          <div className="container-x relative z-10 pt-16 pb-20 md:pt-24 md:pb-28">
            <div className="grid md:grid-cols-12 gap-8 md:gap-12 items-start">
              <div className="md:col-span-6">
                <span className="eyebrow reveal reveal-1">
                  <span className="dot" aria-hidden="true" />
                  For the wedding party
                </span>
                {/* Hero display capped below the global .text-display ceiling so
                    the two sentences hold as two groups beside the demo instead
                    of wrapping to five lines with orphans. */}
                <h1
                  className="text-display mt-6 reveal reveal-2"
                  style={{ fontSize: "clamp(40px, 5.2vw, 68px)" }}
                >
                  You wrote it.
                  <br />
                  Now find out what it{" "}
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
                    sounds
                  </span>{" "}
                  like.
                </h1>
                <p className="mt-6 text-body md:text-subheading reveal reveal-3" style={{ ...muted, maxWidth: "26rem" }}>
                  Read a speech out loud once and SpeechPrep gives you the timing, the lines you
                  skipped, and one thing to fix before the day. Try it on the sample. About a
                  minute, no account, nothing saved.
                </p>
              </div>

              {/* No wrapper chrome: the demo's own script card is the card. */}
              <div id="try" className="md:col-span-6 reveal reveal-3" style={{ scrollMarginTop: 96 }}>
                <DemoClient embedded />
              </div>
            </div>
          </div>
        </section>

        {/* What comes back. A definition list, asymmetric, no icon cards. */}
        <section id="what" className="surface-whisper" style={{ paddingBlock: 88 }}>
          <div className="container-x grid md:grid-cols-12 gap-10">
            <div className="md:col-span-4">
              <span className="text-caption" style={muted}>
                After one read
              </span>
              <h2 className="text-heading-lg mt-4">Three specific things come back.</h2>
              <p className="text-body mt-5" style={muted}>
                Each one is something you can act on tonight.
              </p>
            </div>
            <dl className="md:col-span-7 md:col-start-6" style={{ display: "grid", gap: 28 }}>
              {WHAT_COMES_BACK.map((item) => (
                <div key={item.term} style={{ borderTop: "1px solid rgba(17,17,17,0.12)", paddingTop: 20 }}>
                  <dt className="text-subheading">{item.term}</dt>
                  <dd className="text-body mt-2" style={{ ...muted, maxWidth: "36rem" }}>
                    {item.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Who it's for. The role pages, with a line each. */}
        <section id="roles" style={{ paddingBlock: 88 }}>
          <div className="container-narrow">
            <span className="text-caption" style={muted}>
              Written for the wedding party
            </span>
            <h2 className="text-heading-lg mt-4" style={{ maxWidth: "30rem" }}>
              Each role has its own shape, and its own way of{" "}
              <span className="underline-wavy">going wrong</span>.
            </h2>
            <ul className="mt-10" style={{ display: "grid", gap: 0 }}>
              {ROLES.map((r) => (
                <li key={r.slug} style={{ borderTop: "1px solid rgba(17,17,17,0.12)" }}>
                  <Link
                    href={`/${r.slug}`}
                    className="grid md:grid-cols-12 gap-2 md:gap-6 items-baseline"
                    style={{ paddingBlock: 18, textDecoration: "none", color: "inherit" }}
                  >
                    <span className="text-subheading md:col-span-5">{r.h1}</span>
                    <span className="text-body-sm md:col-span-6" style={muted}>
                      {r.pitfall.title}
                    </span>
                    <span className="text-body-sm md:col-span-1 md:text-right" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-body-sm mt-8" style={muted}>
              Worried about remembering it?{" "}
              <Link href="/how-to-memorize-a-speech" style={{ color: "var(--color-midnight-ink)" }}>
                How to memorize a speech
              </Link>
              , with a five-day plan.
            </p>
          </div>
        </section>

        {/* Pricing. Two tiers. The free rehearsal is a sentence, not a card. */}
        <section id="pricing" className="surface-whisper" style={{ paddingBlock: 88 }}>
          <div className="container-x">
            <div style={{ maxWidth: "36rem" }}>
              <span className="text-caption" style={muted}>
                Pricing
              </span>
              <h2 className="text-heading-lg mt-4">One speech, $24, once.</h2>
              <p className="text-body mt-5" style={muted}>
                A human coach runs about $50 for half an hour. The Event Pass is $24 one time, for
                a month of unlimited rehearsals and coaching on{" "}
                <span className="hl">the one speech you have to give</span>. Your first full
                rehearsal is free, no card.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-5 mt-12" style={{ maxWidth: "56rem" }}>
              <PricingCard
                name="Event Pass"
                price="$24"
                cadence="once"
                tagline="One speech, 30 days, no subscription"
                cta="Get the Event Pass"
                dark
                right="For the speech that matters"
                features={[
                  "Unlimited rehearsals and coaching for 30 days",
                  "Live pacing nudges while you speak",
                  "What you said against what you wrote, with your ad-libs one click from the script",
                  "Speeches up to sixty minutes",
                  "No auto-renew, nothing to cancel",
                ]}
              />
              <PricingCard
                name="Practiced"
                price="$12"
                cadence="a month"
                tagline="Or $96 a year, two months free"
                cta="Subscribe"
                right="For repeat speakers"
                features={[
                  "Unlimited rehearsals, every speech",
                  "Speeches up to sixty minutes",
                  "Memory recall maps",
                  "Script versioning, every save is a draft",
                  "Per-section timing to the second",
                ]}
              />
            </div>
          </div>
        </section>

        {/* FAQ. Same array feeds the schema above. */}
        <section style={{ paddingBlock: 88 }}>
          <div className="container-narrow">
            <h2 className="text-heading">Questions people ask</h2>
            <div className="mt-6">
              {FAQS.map((f) => (
                <details key={f.q} className="faq-item">
                  <summary>{f.q}</summary>
                  <p className="text-body-sm">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid rgba(17,17,17,0.1)", paddingBlock: 48 }}>
        <div className="container-x grid md:grid-cols-12 gap-10">
          <div className="md:col-span-5">
            <Image
              src="/assets/logo-wordmark-dark.png"
              alt="SpeechPrep"
              width={150}
              height={22}
              style={{ height: 22, width: "auto", display: "block" }}
            />
            <p className="text-body mt-4" style={{ ...muted, maxWidth: "18rem" }}>
              Practice your speech before you give it.
            </p>
          </div>
          <FooterColumn
            heading="Product"
            links={[
              { href: "#try", label: "Try it" },
              { href: "#pricing", label: "Pricing" },
              { href: "/how-to-memorize-a-speech", label: "How to memorize a speech" },
            ]}
          />
          <FooterColumn
            heading="Speeches"
            links={ROLES.map((r) => ({ href: `/${r.slug}`, label: r.h1 }))}
          />
          <FooterColumn
            heading="Company"
            links={[
              { href: "mailto:hello@speechprep.ai", label: "hello@speechprep.ai" },
              { href: "https://artygroup.com", label: "An Artygroup product", external: true },
            ]}
          />
        </div>
        <div className="container-x mt-10 text-caption" style={muted}>
          &copy; 2026 SpeechPrep
        </div>
      </footer>
    </>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { href: string; label: string; external?: boolean }[];
}) {
  return (
    <div className="md:col-span-2">
      <div className="text-caption mb-4" style={muted}>
        {heading}
      </div>
      <ul className="space-y-2.5 text-body-sm">
        {links.map((l) => (
          <li key={l.href}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-midnight-ink)" }}>
                {l.label}
              </a>
            ) : (
              <Link href={l.href} style={{ color: "var(--color-midnight-ink)" }}>
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PricingCard({
  name,
  price,
  cadence,
  tagline,
  cta,
  dark = false,
  features,
  right,
}: {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  cta: string;
  dark?: boolean;
  features: string[];
  right: string;
}) {
  const quiet = dark ? { opacity: 0.6 } : muted;
  return (
    <div
      className={`p-8 flex flex-col ${dark ? "" : "card-bordered"}`}
      style={
        dark
          ? { background: "var(--color-midnight-ink)", color: "var(--color-canvas-white)", borderRadius: 12 }
          : undefined
      }
    >
      <div className="flex items-baseline justify-between gap-x-4 gap-y-1 flex-wrap">
        <h3 className="text-heading-sm">{name}</h3>
        <span className="text-caption" style={quiet}>
          {right}
        </span>
      </div>
      <div className="mt-7 flex items-baseline gap-2">
        <span className="num serif" style={{ fontSize: 64, lineHeight: 1, letterSpacing: "-0.02em" }}>
          {price}
        </span>
        <span className="text-body-sm" style={quiet}>
          {cadence}
        </span>
      </div>
      <p className="text-body-sm mt-1" style={quiet}>
        {tagline}
      </p>
      <ul className="mt-7 space-y-2.5 text-body-sm" style={{ flex: 1 }}>
        {features.map((f) => (
          <li key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span aria-hidden="true" style={{ ...quiet, flexShrink: 0 }}>
              &middot;
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/login"
        className={dark ? "btn-light justify-center" : "btn-primary justify-center"}
        style={{ marginTop: 28 }}
      >
        {cta}
      </Link>
    </div>
  );
}
