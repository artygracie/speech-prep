"use client";

// First-run fork: the two doors into a first speech, then the
// upload-first intake in place when "Already written?" is chosen.
// "Need help writing it?" routes to the AI writer.

import { useState, useSyncExternalStore } from "react";
import { StartFork } from "@/components/start-fork";
import { OnboardingForm } from "./onboarding-form";
import {
  getDemoDraftServerSnapshot,
  getDemoDraftSnapshot,
  subscribeDemoDraft,
} from "@/lib/demo-draft";

export function OnboardingStart({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  // null means "the user hasn't chosen yet", so the demo draft decides.
  // Someone arriving from the demo has already written their speech and
  // read it out loud; asking "where's your speech at right now?" again
  // would be the app forgetting what just happened.
  const [chosen, setStep] = useState<"fork" | "upload" | null>(null);
  const draft = useSyncExternalStore(
    subscribeDemoDraft,
    getDemoDraftSnapshot,
    getDemoDraftServerSnapshot,
  );
  const step = chosen ?? (draft ? "upload" : "fork");

  if (step === "fork") {
    return (
      <div>
        <h2 className="text-heading-sm" style={{ fontWeight: 600 }}>
          Where&rsquo;s your speech at right now?
        </h2>
        <div className="mt-5">
          <StartFork writeHref="/app/write" onUpload={() => setStep("upload")} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setStep("fork")}
        className="text-body-sm"
        style={{
          color: "var(--color-muted-ash)",
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
        }}
      >
        ← Both options
      </button>
      <h2 className="text-heading-sm mt-4" style={{ fontWeight: 600 }}>
        Drop it in.
      </h2>
      <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
        Upload a PDF, word doc, or .txt
      </p>
      <div className="mt-5">
        <OnboardingForm action={action} />
      </div>
    </div>
  );
}
