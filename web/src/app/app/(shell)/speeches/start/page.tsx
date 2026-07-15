// The fork: two doors into a new speech. Every "New speech" entry point
// routes here first so the writer and the uploader each get to be
// single-minded destinations.

import Link from "next/link";
import { StartFork } from "@/components/start-fork";

export const metadata = { title: "New speech — SpeechPrep" };

export default function StartSpeechPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/app" className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
        ← Back to speeches
      </Link>
      <h1 className="text-heading-lg mt-3">
        Where&rsquo;s your speech at right now?
      </h1>

      <div className="mt-6">
        <StartFork writeHref="/app/write" uploadHref="/app/speeches/new" />
      </div>
    </div>
  );
}
