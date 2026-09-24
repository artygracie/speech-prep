// "How to memorize a speech": the first content piece (ART-811).
//
// Why this page, and why it looks like this:
//   * It targets one cluster on one URL: "how to memorize a speech" (2,900/mo,
//     KD 9) plus "fast" / "quickly" (1,300 each) and "how to remember a
//     speech" (880). The SEO playbook bans splitting that equity across thin
//     variant pages, so the "fast" intent is served by a real section below
//     ("If you only have tonight"), not a second URL.
//   * The playbook also bans informational posts that never funnel to the
//     product. This one routes readers into /demo and the role pages, because
//     SpeechPrep genuinely is the retrieval-practice-with-feedback tool the
//     research recommends. The CTA is the logical next step, not a bolt-on.
//   * The substance comes from docs/memorization-research.md. Claims are held
//     to what that research supports. Two were softened on purpose: no
//     specific percentage for the read-aloud advantage, and "in the evening,
//     before sleep" rather than a hard hour count, because the primary
//     sources don't support that much precision for a general reader.
//
// Voice: the coach. US spelling (the search term is "memorize"). No em-dashes.

import Image from "next/image";
import Link from "next/link";
import { ROLES } from "@/lib/roles";
import { SITE_URL } from "@/lib/site";

const PATH = "/how-to-memorize-a-speech";
const TITLE = "How to Memorize a Speech: What the Research Says Works";
const DESCRIPTION =
  "Rereading your speech is the least effective way to learn it. Here is what memory research says works, a five-day plan, and what to do if you only have tonight.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}${PATH}`, type: "article" },
};

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const SHORT_VERSION = [
  "Read it out loud, never silently.",
  "Test yourself instead of rereading.",
  "Practice in short sessions, a day apart.",
  "Do one session in the evening, before sleep.",
  "Learn it in chunks, adding one at a time.",
  "Know your first and last lines cold.",
  "When you blank, keep going.",
  "Stop editing a couple of days before.",
];

type Principle = { title: string; body: string[] };

const PRINCIPLES: Principle[] = [
  {
    title: "Read it out loud, never silently",
    body: [
      "Saying words out loud makes them more memorable than reading them in your head. This is one of the most reliably replicated findings in memory research, and it has an obvious second benefit: you are rehearsing the thing you will actually do.",
      "Silent reading also flatters you. It is faster than speech, it never stumbles, and it glides over exactly the words you will trip on in front of a room.",
    ],
  },
  {
    title: "Test yourself instead of rereading",
    body: [
      "This is the single biggest lever. In a well-known study, people who tried to recall a passage from memory remembered far more of it days later than people who spent the same time rereading it. Rereading feels productive because the words look familiar. Familiar is not the same as retrievable.",
      "So after your first read or two, put the script down and try to say it. Look only when you are stuck, and only for as long as it takes to get unstuck. It will feel worse than rereading. That difficulty is the point.",
    ],
  },
  {
    title: "Practice in short sessions, a day apart",
    body: [
      "Four short sessions over four days beat one long session the night before, even when the total time is the same. For a speech a few days away, the sweet spot is roughly one session every twelve to twenty-four hours.",
      "This is good news if you are busy. Fifteen minutes is enough. You do not need to find a free afternoon.",
    ],
  },
  {
    title: "Do one session in the evening, before sleep",
    body: [
      "Sleep is when new memories consolidate, and material learned in the hours before sleep tends to stick better than material learned early in a long day. If you can only practice once a day, make it the evening.",
    ],
  },
  {
    title: "Learn it in chunks, adding one at a time",
    body: [
      "Split the speech into four to six pieces by meaning, not by word count: the opening, the story, the turn, the close. Then build it up cumulatively. Say the first chunk. Then the first and second. Then the first three.",
      "The reason this works is that mistakes cluster at the joins between sections. Practicing each chunk on its own leaves the transitions rehearsed only once. Building up cumulatively means you run every join, every time.",
    ],
  },
  {
    title: "Know your first and last lines cold",
    body: [
      "People remember the beginning and end of a sequence best, and so will your audience. Your opening line also sets your rhythm while your hands are shaking.",
      "These two lines are the only part worth drilling to the point of boredom. Say them until they come out without thinking, and you will have somewhere solid to stand at both ends.",
    ],
  },
  {
    title: "When you blank, keep going",
    body: [
      "Most people rehearse by stopping and starting over every time they lose a line. That trains exactly the wrong reflex for the day, when starting over is not an option.",
      "Instead, pause for a second, say the gist of what comes next in whatever words arrive, and carry on. Check the script afterwards. When you rerun a section you lost, start one chunk before it rather than from the top.",
    ],
  },
  {
    title: "Stop editing a couple of days before",
    body: [
      "Every time you change the wording, you are partly starting over. Get the script where you want it early, then lock it. A slightly imperfect line you know well will serve you far better than a perfect one you learned yesterday.",
    ],
  },
];

const FIVE_DAY_PLAN = [
  {
    day: "Day 1",
    focus: "Understand it, don't memorize it",
    what: "Read it out loud slowly twice. Mark where the sections break and what each one is for. Build it up chunk by chunk from the script in the evening. Lock the wording tonight.",
  },
  {
    day: "Day 2",
    focus: "First attempts from memory",
    what: "Drill the opening and closing lines. Try the whole thing from memory, peeking when stuck. In the evening, one full run with the script face down, then work on the section that went worst.",
  },
  {
    day: "Day 3",
    focus: "Off the page",
    what: "Run it without the script. Practice each transition on its own a few times. Try one cold start: no warm-up, just stand up and begin.",
  },
  {
    day: "Day 4",
    focus: "Rehearse the real thing",
    what: "Stand up, hold a glass, speak at full volume, look up. Do it somewhere unfamiliar at least once. Rerun only the transitions that are still failing.",
  },
  {
    day: "The day",
    focus: "Light touch, then stop",
    what: "One relaxed full run in the morning. Then put it away. In the half hour before, say only your first and last lines in your head.",
  },
];

const FAQS = [
  {
    q: "How long does it take to memorize a speech?",
    a: "For a typical three to five minute wedding speech, most people can get comfortably off the page in four or five short daily sessions of about fifteen minutes. Spreading those sessions out matters more than the total time you spend.",
  },
  {
    q: "Can I memorize a speech in one night?",
    a: "You can get far enough to deliver it well, but not word-perfect. Aim to know your first and last lines cold and the order of your sections, and let yourself use your own words in between. Use the one-night approach above, and sleep: it does real work.",
  },
  {
    q: "Is it OK to use notes?",
    a: "Yes, and nobody at a wedding will think less of you for it. What the room notices is whether you look up. A card with a word or two per section is often the best of both: it keeps the order safe while leaving your eyes free.",
  },
  {
    q: "What should I do if I go blank in the middle?",
    a: "Pause, breathe, and say the gist of the next thing in whatever words come. The audience does not have your script and will not notice a paraphrase. They will notice a long silence or starting over, which is why it is worth practicing pushing through.",
  },
  {
    q: "Does recording yourself help?",
    a: "It helps more with delivery than with memory: you hear your pace, your filler words, and the sections that drag. The most useful version is recording a run from memory and checking which lines you dropped or changed, rather than listening to the whole thing back each time.",
  },
];

// Every entry was resolved against Crossref or NCBI before publishing, and
// labelled from the returned metadata rather than from memory. Three labels
// in docs/memorization-research.md turned out to be wrong (a mistitled
// Roediger & Karpicke paper, "Rohrer & Pashler" that is really Rohrer &
// Taylor, and a "Noice & Noice" link that is a different study entirely), so
// do not copy citations out of that doc without checking them.
const SOURCES = [
  {
    label: "Roediger & Karpicke (2006). Test-enhanced learning. Psychological Science.",
    href: "https://doi.org/10.1111/j.1467-9280.2006.01693.x",
  },
  {
    label: "Cepeda, Vul, Rohrer, Wixted & Pashler (2008). Spacing effects in learning. Psychological Science.",
    href: "https://doi.org/10.1111/j.1467-9280.2008.02209.x",
  },
  {
    label: "MacLeod, Gopie & Hourihan (2010). The production effect. Journal of Experimental Psychology.",
    href: "https://pubmed.ncbi.nlm.nih.gov/20438265/",
  },
  {
    label: "Holz et al. (2012). The timing of learning before night-time sleep. PLoS One.",
    href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3395672/",
  },
  {
    label: "Noice & Noice (2006). What studies of actors and acting can tell us about memory. Current Directions in Psychological Science.",
    href: "https://doi.org/10.1111/j.0963-7214.2006.00398.x",
  },
  {
    label: "Rohrer & Taylor (2006). The effects of overlearning and distributed practice. Applied Cognitive Psychology.",
    href: "https://doi.org/10.1002/acp.1266",
  },
];

// ---------------------------------------------------------------------------
// Structured data. Real content only; no review or rating markup.
// ---------------------------------------------------------------------------

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: TITLE,
  description: DESCRIPTION,
  mainEntityOfPage: `${SITE_URL}${PATH}`,
  publisher: { "@type": "Organization", name: "SpeechPrep", url: SITE_URL },
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const muted = { color: "var(--color-muted-ash)" } as const;

export default function HowToMemorizeASpeechPage() {
  return (
    <main className="min-h-screen" style={{ background: "var(--color-canvas-white)" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <header className="container-x py-5 flex items-center justify-between">
        <Link href="/" aria-label="SpeechPrep home" className="inline-flex">
          <Image
            src="/assets/logo-wordmark-dark.png"
            alt="SpeechPrep"
            width={150}
            height={22}
            priority
            style={{ height: 22, width: "auto" }}
          />
        </Link>
        <Link href="/login" className="text-body-sm" style={muted}>
          Sign in
        </Link>
      </header>

      <article>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="hero-bg" aria-hidden="true" />
          <div className="container-narrow relative" style={{ paddingTop: 56, paddingBottom: 40 }}>
            <span className="eyebrow reveal reveal-1">
              <span className="dot" aria-hidden="true" />
              A guide, grounded in memory research
            </span>
            <h1 className="text-heading-lg mt-6 reveal reveal-2">
              How to{" "}
              <span className="serif" style={{ fontSize: "1.08em" }}>
                memorize
              </span>{" "}
              a speech
            </h1>
            <p className="text-body md:text-subheading mt-5 reveal reveal-3" style={{ ...muted, maxWidth: "38rem" }}>
              The way most people do it, reading the script over and over in one sitting, is the
              least effective method there is. Here is what actually works, and a plan you can
              start tonight.
            </p>
          </div>
        </section>

        {/* Short version: the snippet-shaped answer */}
        <section className="container-narrow" style={{ paddingBottom: 24 }}>
          <div className="card-bordered" style={{ padding: 24 }}>
            <h2 className="text-caption" style={muted}>
              The short version
            </h2>
            <ol style={{ display: "grid", gap: 10, marginTop: 14, paddingLeft: 22, listStyle: "decimal" }}>
              {SHORT_VERSION.map((line) => (
                <li key={line} className="text-body">
                  {line}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Principles */}
        {PRINCIPLES.map((p, i) => (
          <section key={p.title} className="container-narrow" style={{ paddingBlock: 32 }}>
            <span className="text-caption num" style={muted}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h2 className="text-heading mt-2">{p.title}</h2>
            {p.body.map((para) => (
              <p key={para.slice(0, 32)} className="text-body mt-4" style={{ ...muted, maxWidth: "40rem" }}>
                {para}
              </p>
            ))}
          </section>
        ))}

        {/* The funnel: earned, and genuinely the next step */}
        <section className="surface-whisper" style={{ paddingBlock: 64, marginTop: 24 }}>
          <div className="container-narrow">
            <h2 className="text-heading" style={{ maxWidth: "32rem" }}>
              The hard part is knowing{" "}
              <span className="underline-wavy">what you actually dropped</span>.
            </h2>
            <p className="text-body mt-5" style={{ ...muted, maxWidth: "40rem" }}>
              Testing yourself only works if you can tell where you went wrong, and you cannot
              check your own recall while you are mid-sentence. SpeechPrep listens while you run
              it from memory, then shows you the <span className="hl">lines you skipped or changed</span>,
              how long each section took, and the one thing to fix before your next run.
            </p>
            <div className="mt-8 flex items-center gap-4 flex-wrap">
              <Link href="/demo" className="btn-primary">
                Try it on a sample speech →
              </Link>
              <span className="text-body-sm" style={muted}>
                About a minute. No account.
              </span>
            </div>
          </div>
        </section>

        {/* If you only have tonight: serves the "fast" / "quickly" intent honestly */}
        <section className="container-narrow" style={{ paddingBlock: 64 }}>
          <h2 className="text-heading">If you only have tonight</h2>
          <p className="text-body mt-4" style={{ ...muted, maxWidth: "40rem" }}>
            You will not get it word-perfect, and you do not need to. Aim to be the kind of
            prepared where you know the shape cold and trust yourself with the words in between.
          </p>
          <ol style={{ display: "grid", gap: 12, marginTop: 24, paddingLeft: 22, listStyle: "decimal", maxWidth: "40rem" }}>
            <li className="text-body">
              Read it out loud twice, slowly. Mark where each section starts and what it is for.
            </li>
            <li className="text-body">
              Say your first line and your last line out loud until they come out without
              thinking.
            </li>
            <li className="text-body">
              Build it up in chunks: first section, then the first two, then the first three.
            </li>
            <li className="text-body">
              Put the script face down and run the whole thing once. Push through anything you
              lose. Then check, and rerun only the section that broke.
            </li>
            <li className="text-body">
              Do one last full run shortly before bed. Then stop, and sleep.
            </li>
            <li className="text-body">
              In the morning, one relaxed run on your feet. Write a word or two per section on a
              card for your pocket. Then leave it alone.
            </li>
          </ol>
        </section>

        {/* Five-day plan */}
        <section className="surface-whisper" style={{ paddingBlock: 64 }}>
          <div className="container-narrow">
            <h2 className="text-heading">A five-day plan</h2>
            <p className="text-body mt-4" style={{ ...muted, maxWidth: "40rem" }}>
              About fifteen minutes a session. If you can manage two a day, make one of them the
              evening.
            </p>
            <div style={{ overflowX: "auto", marginTop: 24 }}>
              <table className="compare-table" style={{ background: "var(--color-canvas-white)", borderRadius: 12 }}>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Focus</th>
                    <th scope="col">What to do</th>
                  </tr>
                </thead>
                <tbody>
                  {FIVE_DAY_PLAN.map((d) => (
                    <tr key={d.day}>
                      <th scope="row" className="row-label">
                        {d.day}
                      </th>
                      <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{d.focus}</td>
                      <td style={muted}>{d.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Word-perfect */}
        <section className="container-narrow" style={{ paddingBlock: 64 }}>
          <h2 className="text-heading">Do you need it word-perfect?</h2>
          <p className="text-body mt-4" style={{ ...muted, maxWidth: "40rem" }}>
            No. Research on how actors learn their lines found that they do not rely on rote
            repetition at all. They work out what each line is for and why it comes next, and the
            words follow. A speech learned that way survives a nervous moment far better than one
            memorized as a string of words, because if you lose a word you still know where you
            are going.
          </p>
          <p className="text-body mt-4" style={{ ...muted, maxWidth: "40rem" }}>
            The practical version: be word-perfect on your opening and your final line. Everywhere
            else, know what you are trying to say and let the exact words come.
          </p>
        </section>

        {/* Role pages: internal links with descriptive anchors */}
        <section className="container-narrow" style={{ paddingBottom: 48 }}>
          <div className="card-bordered" style={{ padding: 24 }}>
            <h2 className="text-subheading">Still writing it?</h2>
            <p className="text-body-sm mt-2" style={muted}>
              How long it should run, the shape that works, and the thing that usually goes wrong,
              for each role:
            </p>
            <ul style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
              {ROLES.map((r) => (
                <li key={r.slug}>
                  <Link href={`/${r.slug}`} className="badge" style={{ textDecoration: "none" }}>
                    {r.h1.replace(/^The /, "").replace(/^\w/, (c) => c.toUpperCase())}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section className="container-narrow" style={{ paddingBlock: 48 }}>
          <h2 className="text-heading">Questions people ask</h2>
          <div className="mt-6">
            {FAQS.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{f.q}</summary>
                <p className="text-body-sm">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Sources */}
        <section className="container-narrow" style={{ paddingBlock: 48 }}>
          <h2 className="text-caption" style={muted}>
            Research this guide draws on
          </h2>
          <ul style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {SOURCES.map((s) => (
              <li key={s.href} className="text-body-sm">
                <a href={s.href} rel="noopener" target="_blank" style={{ color: "var(--color-midnight-ink)" }}>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </article>

      <footer className="container-x" style={{ paddingBlock: 40, borderTop: "1px solid rgba(17,17,17,0.08)" }}>
        <p className="text-body-sm" style={muted}>
          SpeechPrep. Practice your speech before you give it.
        </p>
      </footer>
    </main>
  );
}
