// Dev-only visual harness for the intake forms. Lets design review happen
// without an authed session: renders both intake forms with a no-op
// action. 404s outside development — never reachable in production.

import { notFound } from "next/navigation";
import { NewSpeechForm } from "@/app/app/(shell)/speeches/new/new-speech-form";
import { OnboardingStart } from "@/app/app/onboarding/onboarding-start";
import { ScriptIntake } from "@/components/script-intake";
import { StartFork } from "@/components/start-fork";

export default function IntakePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  async function noop(formData: FormData) {
    "use server";
    console.log("[dev/intake] submit", {
      title: formData.get("title"),
      source: formData.get("source"),
      occasion: formData.get("occasion"),
      event_date: formData.get("event_date"),
      bodyChars: String(formData.get("body") ?? "").length,
    });
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", display: "grid", gap: 64 }}>
      <section>
        <h1 className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          DEV · fork (/app/speeches/start)
        </h1>
        <h2 className="text-heading-lg mt-4">Where&rsquo;s your speech at right now?</h2>
        <div className="mt-6">
          <StartFork writeHref="/app/write" uploadHref="/app/speeches/new" />
        </div>
      </section>
      <section>
        <h1 className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          DEV · upload page (new-speech form, upload-first)
        </h1>
        <h2 className="text-heading-lg mt-4">Drop it in.</h2>
        <p className="text-body mt-2" style={{ color: "var(--color-muted-ash)" }}>
          Upload a PDF, word doc, or .txt
        </p>
        <div className="mt-5">
          <NewSpeechForm action={noop} />
        </div>
      </section>
      <section>
        <h1 className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          DEV · onboarding fork + upload step
        </h1>
        <div className="mt-4">
          <OnboardingStart action={noop} />
        </div>
      </section>
      <section>
        <h1 className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          DEV · document card (file-loaded state)
        </h1>
        <form className="mt-4">
          <ScriptIntake
            initialFile={{
              name: "Maya Wedding Toast - Final Draft.pdf",
              pages: 3,
              body: SAMPLE_TOAST,
            }}
          />
        </form>
      </section>
    </main>
  );
}

const SAMPLE_TOAST = `Good evening, everyone! For those I haven't met yet, I'm Jordan — Maya's maid of honor, college roommate, and the person who has heard every draft of every important decision she's made for the last twelve years.

When Maya told me she'd met someone, she didn't lead with where he worked or what he looked like. She said: "He asks the second question." Most people ask how your day was. Sam asks how your day was, and then asks about the thing you actually wanted to talk about.

${Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 2} of the sample toast, here to make the word count realistic for the time estimate. `.repeat(6)).join("\n\n")}

So please raise a glass — to Maya and Sam, and to always asking the second question.`;
