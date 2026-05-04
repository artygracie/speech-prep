// New speech form. Submission is a server action that creates the speech +
// v1 + sections, then redirects into the editor.

import Link from "next/link";
import { createSpeech } from "../../../actions";
import { NewSpeechForm } from "./new-speech-form";

export const metadata = { title: "New speech — SpeechPrep" };

export default function NewSpeechPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/app" className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
        ← Back to speeches
      </Link>
      <h1 className="text-heading-lg mt-3">A new speech.</h1>
      <p className="text-body mt-2" style={{ color: "var(--color-muted-ash)" }}>
        Drop your script in or paste it below. We&rsquo;ll suggest section breaks once
        you&rsquo;re in the editor.
      </p>

      <div className="mt-5">
        <NewSpeechForm action={createSpeech} />
      </div>
    </div>
  );
}
