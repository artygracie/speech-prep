// Landing page, v2.
//
// Structure reverse-engineered from a reference template and re-expressed
// in Arty UI tokens: floating pill nav, a centered hero stack, then the
// product in a window frame that bleeds under the fold, dashed rails as the
// page grid, split section heads, and hairline cells instead of shadowed
// cards. The reasoning and the measurements are in
// .arty-ui/reviews/2026-09-16-landing-v2/plan.md.
//
// The one thing the reference cannot do: its window holds a screenshot.
// Ours holds the product, running.
//
// Accent appears twice at rest (one wavy underline, the recording dot once
// a take starts). btn-primary is ink. No em-dashes.

import Image from "next/image";
import Link from "next/link";
import { DemoClient } from "./demo/demo-client";
import { ROLES } from "@/lib/roles";
import { SAMPLE_SECTIONS } from "@/lib/demo-sample";
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
      description: "First full rehearsal free, with the complete coach report. No card.",
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

const muted = { color: "var(--color-muted-ash)" } as const;
const hairline = "1px solid rgba(17,17,17,0.08)";

// ---------------------------------------------------------------------------
// Small real-UI fragments for the feature cells. Data shapes come from the
// sample speech so they look like the product because they are.
// ---------------------------------------------------------------------------

function TimingMock() {
  const rows = SAMPLE_SECTIONS.map((s, i) => ({
    name: s.name,
    target: s.target_seconds,
    // Illustrative: the story runs long, the rest is on pace.
    actual: i === 1 ? s.target_seconds + 11 : s.target_seconds + (i === 3 ? -2 : 1),
  }));
  const max = Math.max(...rows.map((r) => Math.max(r.actual, r.target)));
  return (
    <div className="mock" style={{ display: "grid", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.name} style={{ display: "grid", gridTemplateColumns: "72px 1fr 40px", gap: 10, alignItems: "center" }}>
          <span style={{ ...muted, fontSize: 12 }}>{r.name}</span>
          <span style={{ position: "relative", height: 8, background: "rgba(17,17,17,0.08)", borderRadius: 999 }}>
            <span
              style={{
                position: "absolute", inset: 0, width: `${(r.actual / max) * 100}%`, borderRadius: 999,
                background: r.actual - r.target > 5 ? "var(--color-accent)" : "var(--color-midnight-ink)",
              }}
            />
          </span>
          <span className="num" style={{ fontSize: 12, textAlign: "right" }}>{r.actual}s</span>
        </div>
      ))}
    </div>
  );
}

function DiffMock() {
  return (
    <div className="mock text-body-sm" style={{ lineHeight: 1.7 }}>
      He had a ring, he had a speech,{" "}
      <span style={{ textDecoration: "line-through", ...muted }}>he had the restaurant booked</span>{" "}
      <span style={{ background: "rgba(71,208,150,0.22)", borderRadius: 3, padding: "0 3px" }}>
        he had the whole night planned
      </span>
      . He was so nervous he left the ring in the car.
    </div>
  );
}

function OneThingMock() {
  return (
    <div className="mock" style={{ display: "grid", gap: 6 }}>
      <span className="text-caption" style={muted}>The one thing to fix · The story</span>
      <span className="text-body" style={{ fontWeight: 500 }}>You rushed the butter knife line.</span>
      <span className="text-body-sm" style={muted}>
        It is the laugh. Give it a full second after &ldquo;I did not.&rdquo;
      </span>
    </div>
  );
}

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

      <div className="rail">
        <div className="hero-bg" aria-hidden="true" />
        {/* Floating pill nav */}
        <header className="nav-pill">
          <Link href="/" aria-label="SpeechPrep home" className="flex items-center">
            <Image
              src="/assets/logo-wordmark-dark.png"
              alt="SpeechPrep"
              width={130}
              height={19}
              priority
              style={{ height: 19, width: "auto", display: "block" }}
            />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <a href="#what" className="nav-link">How it works</a>
            <a href="#roles" className="nav-link">Speeches</a>
            <a href="#pricing" className="nav-link">Pricing</a>
          </nav>
          <div className="flex items-center gap-1">
            <Link href="/login" className="nav-link">Sign in</Link>
            <a href="#try" className="nav-cta">
              Try it
            </a>
          </div>
        </header>

        <main>
          {/* Hero: headline, one line of copy, then the product in a window.
              The ambient gradient runs from the very top of the page. */}
          <section className="relative">
            <div className="rail-x hero-top relative" style={{ textAlign: "center" }}>
              <h1 className="text-display-marketing reveal reveal-1" style={{ maxWidth: "12ch", marginInline: "auto" }}>
                Give your best speech.
              </h1>
              <p
                className="mt-6 reveal reveal-2"
                style={{ ...muted, fontSize: "clamp(17px, 1.4vw, 20px)", lineHeight: 1.45, maxWidth: "36rem", marginInline: "auto" }}
              >
                Practice makes perfect. Write and practice your speech out loud with our live
                coach to memorize your lines and time those laughs.
              </p>
              <p className="mt-5 text-body-sm reveal reveal-3" style={muted}>
                About a minute. No account, nothing saved.
              </p>
            </div>

            <div id="try" className="rail-x relative reveal reveal-4" style={{ scrollMarginTop: 88, marginTop: 48, paddingBottom: 72 }}>
              <DemoClient variant="frame" />
            </div>
          </section>

          {/* What comes back: split head, then three hairline cells with real fragments. */}
          <section id="what" className="rail-x" style={{ paddingBlock: 96, borderTop: hairline }}>
            <div className="grid md:grid-cols-12 gap-8 items-end">
              <div className="md:col-span-7">
                <span className="text-caption" style={muted}>After one read</span>
                <h2 className="text-heading-marketing mt-4">Three specific things come back.</h2>
              </div>
              <p className="md:col-span-4 md:col-start-9 text-body" style={muted}>
                Each one is something you can act on tonight. The full breakdown is there when
                you want it, and never in the way when you don&rsquo;t.
              </p>
            </div>
            <div className="cells cells-3 mt-12">
              <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
                <TimingMock />
                <div>
                  <h3 className="text-subheading">Timing, section by section</h3>
                  <p className="text-body-sm mt-2" style={muted}>
                    How long each part took against how long it is written to run. It is
                    usually the story that runs long.
                  </p>
                </div>
              </div>
              <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
                <DiffMock />
                <div>
                  <h3 className="text-subheading">What you said against what you wrote</h3>
                  <p className="text-body-sm mt-2" style={muted}>
                    Every line you dropped, changed, or added, marked on the script. Some of what
                    you changed will be better. Keep those.
                  </p>
                </div>
              </div>
              <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
                <OneThingMock />
                <div>
                  <h3 className="text-subheading">One thing to fix</h3>
                  <p className="text-body-sm mt-2" style={muted}>
                    The single change that will do the most for the next run, and why.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Who it's for: four role cells. */}
          <section id="roles" className="rail-x" style={{ paddingBlock: 96, borderTop: hairline }}>
            <div className="grid md:grid-cols-12 gap-8 items-end">
              <div className="md:col-span-7">
                <span className="text-caption" style={muted}>Written for the wedding party</span>
                <h2 className="text-heading-marketing mt-4">
                  Each role has its own shape, and its own way of{" "}
                  <span className="underline-wavy">going wrong</span>.
                </h2>
              </div>
              <p className="md:col-span-4 md:col-start-9 text-body" style={muted}>
                How long it should run, the beats that work, and the thing that usually goes
                wrong, for each one. Worried about remembering it?{" "}
                <Link href="/how-to-memorize-a-speech" style={{ color: "var(--color-midnight-ink)" }}>
                  How to memorize a speech
                </Link>
                .
              </p>
            </div>
            <div className="cells cells-4 mt-12">
              {ROLES.map((r) => (
                <Link key={r.slug} href={`/${r.slug}`} style={{ textDecoration: "none", color: "inherit", display: "grid", gap: 10, alignContent: "start" }}>
                  <span className="text-caption" style={muted}>{r.eyebrow}</span>
                  <span className="text-subheading">{r.h1}</span>
                  <span className="text-body-sm" style={muted}>{r.pitfall.title}</span>
                  <span className="text-body-sm" style={{ marginTop: "auto", paddingTop: 8 }} aria-hidden="true">Read the guide →</span>
                </Link>
              ))}
            </div>
          </section>

          {/* Pricing: two cells, one sentence for the free rehearsal. */}
          <section id="pricing" className="rail-x" style={{ paddingBlock: 96, borderTop: hairline }}>
            <div className="grid md:grid-cols-12 gap-8 items-end">
              <div className="md:col-span-7">
                <span className="text-caption" style={muted}>Pricing</span>
                <h2 className="text-heading-marketing mt-4">One speech, $24, once.</h2>
              </div>
              <p className="md:col-span-4 md:col-start-9 text-body" style={muted}>
                A human coach runs about $50 for half an hour. Your first full rehearsal is free,
                no card.
              </p>
            </div>
            <div className="cells cells-2 mt-12" style={{ maxWidth: "56rem" }}>
              <PricingCell
                name="Event Pass"
                price="$24"
                cadence="once"
                right="For the speech that matters"
                tagline="One speech, 30 days, no subscription"
                cta="Get the Event Pass"
                featured
                features={[
                  "Unlimited rehearsals and coaching for 30 days",
                  "Live pacing nudges while you speak",
                  "What you said against what you wrote, with your ad-libs one click from the script",
                  "Speeches up to sixty minutes",
                  "No auto-renew, nothing to cancel",
                ]}
              />
              <PricingCell
                name="Practiced"
                price="$12"
                cadence="a month"
                right="For repeat speakers"
                tagline="Or $96 a year, two months free"
                cta="Subscribe"
                features={[
                  "Unlimited rehearsals, every speech",
                  "Speeches up to sixty minutes",
                  "Memory recall maps",
                  "Script versioning, every save is a draft",
                  "Per-section timing to the second",
                ]}
              />
            </div>
          </section>

          {/* FAQ: split head, accordion. Same array feeds the schema. */}
          <section className="rail-x" style={{ paddingBlock: 96, borderTop: hairline }}>
            <div className="grid md:grid-cols-12 gap-8">
              <div className="md:col-span-4">
                <span className="text-caption" style={muted}>Questions</span>
                <h2 className="text-heading-marketing mt-4">Things people ask.</h2>
              </div>
              <div className="md:col-span-7 md:col-start-6">
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

        <footer className="rail-x" style={{ borderTop: hairline, paddingBlock: 48 }}>
          <div className="grid md:grid-cols-12 gap-10">
            <div className="md:col-span-5">
              <Image src="/assets/logo-wordmark-dark.png" alt="SpeechPrep" width={130} height={19} style={{ height: 19, width: "auto", display: "block" }} />
              <p className="text-body mt-4" style={{ ...muted, maxWidth: "18rem" }}>
                Practice your speech before you give it.
              </p>
            </div>
            <FooterColumn heading="Product" links={[{ href: "#try", label: "Try it" }, { href: "#pricing", label: "Pricing" }, { href: "/how-to-memorize-a-speech", label: "How to memorize a speech" }]} />
            <FooterColumn heading="Speeches" links={ROLES.map((r) => ({ href: `/${r.slug}`, label: r.h1 }))} />
            <FooterColumn heading="Company" links={[{ href: "mailto:hello@speechprep.ai", label: "hello@speechprep.ai" }, { href: "https://artygroup.com", label: "An Artygroup product", external: true }]} />
          </div>
          <div className="mt-10 text-caption" style={muted}>&copy; 2026 SpeechPrep</div>
        </footer>
      </div>
    </>
  );
}

function FooterColumn({ heading, links }: { heading: string; links: { href: string; label: string; external?: boolean }[] }) {
  return (
    <div className="md:col-span-2">
      <div className="text-caption mb-4" style={muted}>{heading}</div>
      <ul className="space-y-2.5 text-body-sm">
        {links.map((l) => (
          <li key={l.href}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-midnight-ink)" }}>{l.label}</a>
            ) : (
              <Link href={l.href} style={{ color: "var(--color-midnight-ink)" }}>{l.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PricingCell({
  name, price, cadence, right, tagline, cta, featured = false, features,
}: {
  name: string; price: string; cadence: string; right: string; tagline: string; cta: string; featured?: boolean; features: string[];
}) {
  const quiet = featured ? { opacity: 0.62 } : muted;
  return (
    <div
      className="flex flex-col"
      style={featured ? { background: "var(--color-midnight-ink)", color: "var(--color-canvas-white)" } : undefined}
    >
      <div className="flex items-baseline justify-between gap-x-4 gap-y-1 flex-wrap">
        <h3 className="text-heading-sm">{name}</h3>
        <span className="text-caption" style={quiet}>{right}</span>
      </div>
      <div className="mt-6 flex items-baseline gap-2">
        <span className="num serif" style={{ fontSize: 56, lineHeight: 1, letterSpacing: "-0.02em" }}>{price}</span>
        <span className="text-body-sm" style={quiet}>{cadence}</span>
      </div>
      <p className="text-body-sm mt-1" style={quiet}>{tagline}</p>
      <ul className="mt-6 space-y-2.5 text-body-sm" style={{ flex: 1 }}>
        {features.map((f) => (
          <li key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span aria-hidden="true" style={{ ...quiet, flexShrink: 0 }}>&middot;</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link href="/login" className={featured ? "btn-light justify-center" : "btn-primary justify-center"} style={{ marginTop: 24 }}>
        {cta}
      </Link>
    </div>
  );
}
