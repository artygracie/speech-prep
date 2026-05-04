"use client";

// One-time coach-mark for the recorder. Renders only when:
//  - the URL has `?firstRun=1` (the onboarding flow sends users here
//    with that flag), AND
//  - the user hasn't dismissed it before on this device (localStorage).
//
// We persist dismissal client-side rather than per-account because the
// guidance is about the local browser experience (mic permissions,
// keyboard shortcuts, what the live transcript means) — re-showing it on
// a new device is reasonable. If we ever want server-side persistence we
// can move this into the profiles table.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const STORAGE_KEY = "sp.recorderCoachSeen";

export function FirstRunCoach() {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isFirstRun = params.get("firstRun") === "1";
    if (!isFirstRun) return;
    if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    setOpen(true);
  }, [params]);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Private mode etc. — silent.
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(17,17,17,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="card-bordered"
        style={{
          background: "var(--color-canvas-white)",
          width: "100%",
          maxWidth: 480,
          padding: 32,
          boxShadow: "0 30px 80px rgba(17,17,17,0.18)",
        }}
      >
        <h2 id="coach-title" className="text-heading-sm">
          One quick thing before we start.
        </h2>

        <ol
          style={{
            display: "grid",
            gap: 18,
            marginTop: 20,
            paddingLeft: 0,
            listStyle: "none",
          }}
        >
          {[
            {
              n: "01",
              title: "Mic permission.",
              body: "Your browser will ask for microphone access. Say yes — that's how we listen.",
            },
            {
              n: "02",
              title: "We listen, time, and transcribe — live.",
              body: "The script highlights as you go. Don't stop to admire it; just give the speech.",
            },
            {
              n: "03",
              title: "The first session is a throwaway.",
              body: "Pause, restart, abandon. Three sessions are free. Get a feel for it.",
            },
          ].map((step) => (
            <li
              key={step.n}
              style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 12, alignItems: "baseline" }}
            >
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 22,
                  lineHeight: 1,
                  color: "var(--color-muted-ash)",
                  opacity: 0.55,
                }}
              >
                {step.n}
              </span>
              <div>
                <div className="text-body-sm" style={{ fontWeight: 500 }}>
                  {step.title}
                </div>
                <div
                  className="text-body-sm mt-1"
                  style={{ color: "var(--color-muted-ash)" }}
                >
                  {step.body}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={dismiss}
          className="btn-primary mt-8"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Got it — let&rsquo;s go
        </button>
      </div>
    </div>
  );
}
