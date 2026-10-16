// How to memorize a speech — the guide the homepage and footer link to.
//
// Written for the reader SpeechPrep serves best: someone with a three to
// five minute wedding speech and a date coming up. Like the role pages,
// it has to be useful on its own before it asks for anything, so the
// method comes first and the product arrives at the end.
//
// Every claim here comes from docs/memorization-research.md, which cites
// its sources. Keep them in step: change the research, then this page.
//
// Visual vocabulary matches components/role-page.tsx.

import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const PATH = "/how-to-memorize-a-speech";
const TITLE = "How to Memorize a Speech: A Five-Day Plan That Works";
const DESCRIPTION =
  "Stop rereading your speech. Say it from memory, a little at a time, over a few days. A research-backed plan for memorizing a wedding speech.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}${PATH}`, type: "article" },
};

const STEPS: { name: string; detail: string }[] = [
  {
    name: "Learn what each part is for",
    detail:
      "Before you memorize a word, read it aloud twice and ask why each line is there. Actors don't learn lines by repetition. They learn what each line is doing, and the words follow.",
  },
  {
    name: "Break it into four to six chunks",
    detail:
      "Split it where the meaning changes: who you are, the story, the turn, the toast. Each chunk should run fifteen to thirty seconds. Your memory holds a handful of meaningful pieces, not a page.",
  },
  {
    name: "Build it up in order",
    detail:
      "Say chunk one, then one and two, then one, two and three. Every run practises the joins between chunks, which is exactly where people blank.",
  },
  {
    name: "Test yourself instead of rereading",
    detail:
      "After the first day, put the script down and say it. Peek only when you are stuck. Recalling something, even with effort, fixes it far better than reading it again.",
  },
  {
    name: "Overlearn the first and last lines",
    detail:
      "Your opening line sets your nerves and your rhythm, and your toast line is the moment everyone remembers. Get both to the point where they come out without thinking.",
  },
  {
    name: "Spread it out, and practise before bed",
    detail:
      "Two short sessions a day beat one long one. Make the evening session within two or three hours of sleep, which is when the day's practice settles in.",
  },
];

const DAYS: { day: string; focus: string; detail: string }[] = [
  {
    day: "Day 1",
    focus: "Learn it, don't memorize it",
    detail:
      "Read it aloud slowly, mark your chunks, and build them up in order with the script in front of you. Make your last edits tonight and lock the words.",
  },
  {
    day: "Day 2",
    focus: "First times from memory",
    detail:
      "Say the opening and toast lines from memory five times. Build the chunks up from memory, peeking when stuck. One full run with the script nearby.",
  },
  {
    day: "Day 3",
    focus: "Off the page",
    detail:
      "Whole runs with the script put away. Practise each join between chunks three times. Once during the day, start cold, with no warm-up, the way you will on the night.",
  },
  {
    day: "Day 4",
    focus: "Rehearse the real thing",
    detail:
      "Stand up, hold a glass, speak to the room. Another cold start somewhere unfamiliar. Only drill the joins that slipped.",
  },
  {
    day: "The day",
    focus: "Light touch",
    detail:
      "One full run in the morning, standing, then stop. Before you speak, run the opening and toast lines in your head once. Perform it, don't rehearse it.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "How long does it take to memorize a five-minute speech?",
    a: "Plan on four or five days of two short sessions, fifteen to twenty minutes each. Spreading the practice out matters more than the total time: one long session the night before is the least effective way to do it.",
  },
  {
    q: "Should I memorize it word for word?",
    a: "Know your opening and toast lines word for word. For the middle, aim to know every beat and most of the words, and let yourself paraphrase a line if it comes out differently. Word-perfect memorization is brittle under nerves.",
  },
  {
    q: "What do I do if I blank in the middle?",
    a: "Pause for a breath, say the next thing you do remember, and keep going. Nobody in the room knows your script. When you practise, don't restart from the top after a slip, or you train yourself to restart on the night.",
  },
  {
    q: "Can I use notes?",
    a: "Yes. A card with the first word of each chunk is a good safety net, and practising with it in the middle stage helps you get off the full script. Most people find they never look at it.",
  },
  {
    q: "Is reading it silently enough?",
    a: "No. Saying it out loud is remembered noticeably better than reading it silently, and it is the only way to find out how long it really runs and which lines trip you up.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function MemorizeGuidePage() {
  return (
    <main className="min-h-screen" style={{ background: "var(--color-canvas-white)" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
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
            A guide
          </span>
          <h1 className="text-heading-lg mt-6 reveal reveal-2">How to memorize a speech</h1>
          <p
            className="text-body md:text-subheading mt-5 reveal reveal-3"
            style={{ color: "var(--color-muted-ash)", maxWidth: "36rem" }}
          >
            Stop rereading it. Say it from memory, a little at a time, over a
            few days. Here is the method that works for a three to five minute
            wedding speech, and a day-by-day plan to follow.
          </p>
        </div>
      </section>

      {/* Why rereading fails */}
      <section className="container-narrow" style={{ paddingBlock: 48 }}>
        <h2 className="text-heading">Why rereading doesn&rsquo;t work</h2>
        <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
          Most people memorize by reading the script over and over, silently, the
          night before. It feels productive because the words look familiar. But
          familiar is not the same as remembered. In studies with prose, people
          who tested themselves remembered far more a few days later than people
          who reread, and people who said the words aloud beat people who read
          them silently.
        </p>
      </section>

      {/* The method */}
      <section className="surface-whisper" style={{ paddingBlock: 64 }}>
        <div className="container-narrow">
          <h2 className="text-heading">The method</h2>
          <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
            Six habits, in roughly the order you will need them.
          </p>
          <ol style={{ display: "grid", gap: 12, marginTop: 28 }}>
            {STEPS.map((s, i) => (
              <li key={s.name} className="card-bordered" style={{ padding: 20, display: "flex", gap: 16 }}>
                <span
                  className="text-caption num"
                  aria-hidden="true"
                  style={{ color: "var(--color-muted-ash)", paddingTop: 3 }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong className="text-subheading">{s.name}</strong>
                  <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
                    {s.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Five-day plan */}
      <section className="container-narrow" style={{ paddingBlock: 64 }}>
        <h2 className="text-heading">A five-day plan</h2>
        <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
          Two short sessions a day: one in the morning, one within a few hours of
          bed. Fifteen to twenty minutes each is plenty.
        </p>
        <div style={{ display: "grid", gap: 0, marginTop: 28 }}>
          {DAYS.map((d) => (
            <div
              key={d.day}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(80px, 120px) 1fr",
                gap: 16,
                paddingBlock: 18,
                borderTop: "1px solid rgba(17,17,17,0.08)",
              }}
            >
              <span className="text-caption" style={{ color: "var(--color-muted-ash)", paddingTop: 3 }}>
                {d.day}
              </span>
              <div>
                <strong className="text-subheading">{d.focus}</strong>
                <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
                  {d.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* When you blank */}
      <section className="container-narrow" style={{ paddingBottom: 64 }}>
        <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          The part that goes wrong
        </span>
        <h2 className="text-heading mt-3">Blanking, and starting again from the top</h2>
        <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
          When people slip in practice, they go back to the beginning. Do that
          often enough and it becomes what you do on the night. Instead, pause,
          say the next thing you remember, and keep going. Check the script only
          after the run, and next time start one chunk before the place you
          slipped.
        </p>
      </section>

      {/* The ask, earned */}
      <section className="surface-whisper" style={{ paddingBlock: 72 }}>
        <div className="container-narrow">
          <h2 className="text-heading" style={{ maxWidth: "30rem" }}>
            The hard part is knowing{" "}
            <span className="underline-wavy">what you actually remembered</span>.
          </h2>
          <p className="text-body mt-5" style={{ color: "var(--color-muted-ash)", maxWidth: "40rem" }}>
            Testing yourself only works if you know where you slipped, and you
            can&rsquo;t check a script while you&rsquo;re saying it. SpeechPrep
            listens while you give your speech from memory, then shows you{" "}
            <span className="hl">which parts came back word for word and where you blanked</span>,
            how long it ran, and what to practise next.
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
          {FAQS.map((f) => (
            <details key={f.q} className="faq-item">
              <summary>{f.q}</summary>
              <p className="text-body-sm">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="text-body-sm mt-8" style={{ color: "var(--color-muted-ash)" }}>
          Writing one?{" "}
          <Link href="/best-man-speech" style={{ textDecoration: "underline" }}>Best man</Link>,{" "}
          <Link href="/maid-of-honor-speech" style={{ textDecoration: "underline" }}>maid of honor</Link>,{" "}
          <Link href="/father-of-the-bride-speech" style={{ textDecoration: "underline" }}>father of the bride</Link>, and{" "}
          <Link href="/mother-of-the-groom-speech" style={{ textDecoration: "underline" }}>mother of the groom</Link>{" "}
          guides.
        </p>
      </section>

      <footer className="container-x" style={{ paddingBlock: 40, borderTop: "1px solid rgba(17,17,17,0.08)" }}>
        <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
          SpeechPrep — practice your speech before you give it.
        </p>
      </footer>
    </main>
  );
}
