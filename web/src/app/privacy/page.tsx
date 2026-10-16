// Privacy — what happens to a speech and its recordings.
//
// People record their voice here, often saying things about family they
// would not post anywhere. The page answers the questions they actually
// have, in the order they have them: who hears it, how long it is kept,
// who else touches it, how to delete it. Plain words, no legal register.
//
// Keep it true. When a processor, a retention rule or a contact address
// changes in the code, change it here in the same PR. The retention rule
// is RECORDING_RETENTION in lib/retention.ts.

import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { RECORDING_RETENTION } from "@/lib/retention";

export const metadata: Metadata = {
  title: "Privacy — SpeechPrep",
  description: "Who can hear your recordings, how long we keep them, and how to delete them.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "October 16, 2026";

const PROCESSORS: { name: string; why: string }[] = [
  { name: "Supabase", why: "Stores your account, speeches, recordings and reports (United States)." },
  { name: "Deepgram", why: "Turns your recording into a transcript. Audio is sent for transcription only." },
  { name: "Anthropic", why: "Writes your coach notes and AI drafts from your script and transcript. Audio is not sent." },
  { name: "Stripe", why: "Takes payment. We never see or store your card number." },
  { name: "Vercel and Sentry", why: "Host the site and report errors so we can fix them." },
  { name: "Google", why: "Sign-in, if you choose it, and measuring which ads bring people here." },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ paddingBlock: 28, borderTop: "1px solid rgba(17,17,17,0.08)" }}>
      <h2 className="text-subheading">{title}</h2>
      <div className="text-body mt-3" style={{ color: "var(--color-muted-ash)", display: "grid", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
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

      <div className="container-narrow" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: "44rem" }}>
        <h1 className="text-heading-lg">Privacy</h1>
        <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)" }}>
          Your speech is personal. Here is exactly what happens to it. Last
          updated {UPDATED}.
        </p>

        <Section title="Who can hear your recordings">
          <p>
            Only you. Recordings are stored privately under your account, and
            nobody at SpeechPrep listens to them. The only other place your
            audio goes is our transcription provider, which turns it into text.
          </p>
          <p>
            The sample speech on the homepage is different: that recording is
            transcribed and thrown away. It is never stored.
          </p>
        </Section>

        <Section title="How long we keep them">
          <p>{RECORDING_RETENTION.summary}</p>
          <p>
            Your script, transcripts and reports stay in your account until you
            delete them, so your progress is still there if you come back.
          </p>
        </Section>

        <Section title="What we collect">
          <p>
            Your email address, the speeches you write or upload, your
            recordings, the transcripts and coach notes made from them, and the
            event date if you give one. If you pay, Stripe holds your payment
            details. We also record which pages you visit and which ad or link
            brought you here, so we can tell what is working.
          </p>
          <p>We don&rsquo;t sell your data.</p>
        </Section>

        <Section title="Who else handles it">
          <ul style={{ display: "grid", gap: 8, paddingLeft: 18, listStyle: "disc" }}>
            {PROCESSORS.map((p) => (
              <li key={p.name}>
                <strong style={{ color: "var(--color-midnight-ink)" }}>{p.name}.</strong> {p.why}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Emails">
          <p>
            We send sign-in links and, if you pay, receipts. Nothing else
            today.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Email{" "}
            <a href="mailto:hello@speechprep.ai" style={{ textDecoration: "underline" }}>
              hello@speechprep.ai
            </a>{" "}
            from the address you sign in with, and we will delete your account,
            speeches, recordings and reports within 30 days.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            SpeechPrep is made by Artygroup in Los Angeles. Write to{" "}
            <a href="mailto:hello@speechprep.ai" style={{ textDecoration: "underline" }}>
              hello@speechprep.ai
            </a>{" "}
            and a person will answer.
          </p>
        </Section>
      </div>
    </main>
  );
}
