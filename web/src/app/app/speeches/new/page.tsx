// New speech form. Server-rendered; submission is a server action that
// creates the speech + v1 + sections, then redirects into the editor.

import Link from "next/link";
import { createSpeech } from "../../actions";

export const metadata = { title: "New speech — SpeechPrep" };

export default function NewSpeechPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/app" className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
        ← Back to speeches
      </Link>
      <h1 className="text-heading-lg mt-4">A new speech.</h1>
      <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
        What&rsquo;s it for? Drop the script in below. We&rsquo;ll suggest section breaks once
        you&rsquo;re in the editor — you can keep them, move them, or ignore them.
      </p>

      <form action={createSpeech} className="mt-8" style={{ display: "grid", gap: 20 }}>
        <div>
          <label className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            Title
          </label>
          <input
            className="input input-lg mt-2"
            name="title"
            required
            placeholder="e.g. Best-man speech for Tom"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            Occasion{" "}
            <span
              style={{
                textTransform: "none",
                letterSpacing: 0,
                color: "var(--color-muted-ash)",
                opacity: 0.7,
              }}
            >
              — optional
            </span>
          </label>
          <input
            className="input input-lg mt-2"
            name="occasion"
            placeholder="Wedding, conference talk, eulogy, pitch…"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            The speech
          </label>
          <textarea
            className="input input-lg mt-2"
            name="body"
            rows={14}
            placeholder="Paste it here. Or start from scratch — we'll drop you straight into the editor."
            style={{
              fontFamily: "var(--font-script)",
              fontSize: 16,
              lineHeight: 1.65,
            }}
          />
          <p className="text-caption mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Anything from a few bullets to a full draft. Section breaks are added in the editor.
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <button type="submit" className="btn-primary">
            Open editor
          </button>
          <Link href="/app" className="btn-ghost">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
