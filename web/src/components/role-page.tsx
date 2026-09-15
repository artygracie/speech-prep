// One implementation behind all four wedding-role landing pages.
//
// The page has to earn its click before it asks for one (see the
// landing-page playbook): someone searching "best man speech" wants the
// question answered, not a product pitch. So the structure is answer
// first — length, shape, the specific thing that goes wrong — and the
// demo arrives once we have been useful.
//
// Accent discipline (Arty UI): --color-accent never becomes a big
// coloured button. It appears as the eyebrow dot, the wavy underline on
// the one phrase that matters, and .hl tints. Primary buttons stay ink.

import Image from "next/image";
import Link from "next/link";
import type { Role } from "@/lib/roles";

export function RolePage({ role }: { role: Role }) {
  return (
    <main className="min-h-screen" style={{ background: "var(--color-canvas-white)" }}>
      <header className="container-x py-5 flex items-center justify-between">
        <Link href="/" aria-label="SpeechPrep — home" className="inline-flex">
          <Image
            src="/assets/logo-wordmark-dark.png"
            alt="SpeechPrep"
            width={150}
            height={22}
            priority
            style={{ height: 22, width: "auto" }}
          />
        </Link>
        <Link href="/login" className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-bg" aria-hidden="true" />
        <div className="container-narrow relative" style={{ paddingTop: 56, paddingBottom: 56 }}>
          <span className="eyebrow reveal reveal-1">
            <span className="dot" aria-hidden="true" />
            {role.eyebrow}
          </span>
          <h1 className="text-heading-lg mt-6 reveal reveal-2">{role.h1}</h1>
          <p
            className="text-body md:text-subheading mt-5 reveal reveal-3"
            style={{ color: "var(--color-muted-ash)", maxWidth: "36rem" }}
          >
            {role.intro}
          </p>
          <div className="mt-8 flex items-center gap-4 flex-wrap reveal reveal-4">
            <Link href="/demo" className="btn-primary">
              Read one out loud →
            </Link>
            <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              Takes about a minute. No account.
            </span>
          </div>
        </div>
      </section>

      {/* How long */}
      <section className="container-narrow" style={{ paddingBlock: 48 }}>
        <h2 className="text-heading">How long it should be</h2>
        <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
          {role.length}
        </p>
      </section>

      {/* The shape */}
      <section className="surface-whisper" style={{ paddingBlock: 64 }}>
        <div className="container-narrow">
          <h2 className="text-heading">The shape that works</h2>
          <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
            Four beats, in this order. Not a template to fill in, just the
            structure most speeches that land turn out to have.
          </p>
          <ol style={{ display: "grid", gap: 12, marginTop: 28 }}>
            {role.beats.map((b, i) => (
              <li key={b.name} className="card-bordered" style={{ padding: 20, display: "flex", gap: 16 }}>
                <span
                  className="text-caption num"
                  aria-hidden="true"
                  style={{ color: "var(--color-muted-ash)", paddingTop: 3 }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong className="text-subheading">{b.name}</strong>
                  <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
                    {b.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The pitfall */}
      <section className="container-narrow" style={{ paddingBlock: 64 }}>
        <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          The part that goes wrong
        </span>
        <h2 className="text-heading mt-3">{role.pitfall.title}</h2>
        <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
          {role.pitfall.detail}
        </p>
      </section>

      {/* The ask, earned */}
      <section className="surface-whisper" style={{ paddingBlock: 72 }}>
        <div className="container-narrow">
          <h2 className="text-heading" style={{ maxWidth: "30rem" }}>
            You can write a good speech and still have it{" "}
            <span className="underline-wavy">come apart out loud</span>.
          </h2>
          <p className="text-body mt-5" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
            Most people rehearse by reading silently, which tells you nothing about
            pace, and nothing about the lines you skip when you are nervous.
            SpeechPrep listens to you read and gives you the timing, the{" "}
            <span className="hl">what you actually said versus what you wrote</span>,
            and one thing to fix.
          </p>
          <div className="mt-8 flex items-center gap-4 flex-wrap">
            <Link href="/demo" className="btn-primary">
              Try it on a sample speech →
            </Link>
            <Link href="/#pricing" className="btn-ghost">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="container-narrow" style={{ paddingBlock: 72 }}>
        <h2 className="text-heading">Questions people actually ask</h2>
        <div className="mt-6">
          {role.faqs.map((f) => (
            <details key={f.q} className="faq-item">
              <summary>{f.q}</summary>
              <p className="text-body-sm">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="container-x" style={{ paddingBlock: 40, borderTop: "1px solid rgba(17,17,17,0.08)" }}>
        <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
          SpeechPrep — practice your speech before you give it.
        </p>
      </footer>
    </main>
  );
}
