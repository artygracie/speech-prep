// Upload-first intake — the "Already written?" door from the fork
// (/app/speeches/start). Expects a document; pasting is the fallback.
// Submission is a server action that creates the speech + v1 + sections,
// then redirects into the editor.

import Link from "next/link";
import { createSpeech } from "../../../actions";
import { NewSpeechForm } from "./new-speech-form";

export const metadata = { title: "New speech — SpeechPrep" };

export default function NewSpeechPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <Link
        href="/app/speeches/start"
        className="text-body-sm"
        style={{ color: "var(--color-muted-ash)" }}
      >
        ← Back
      </Link>
      <h1 className="text-heading-lg mt-3">Drop it in.</h1>
      <p className="text-body mt-2" style={{ color: "var(--color-muted-ash)" }}>
        Upload a PDF, word doc, or .txt
      </p>

      <div className="mt-5">
        <NewSpeechForm action={createSpeech} />
      </div>
    </div>
  );
}
