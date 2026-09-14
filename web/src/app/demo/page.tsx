// The public demo — the whole loop with no account.
//
// Indexable on purpose: this is the page role landing pages and ads should
// point at, because it's the only surface that shows the product working
// before asking for anything.

import Image from "next/image";
import Link from "next/link";
import { DemoClient } from "./demo-client";

export const metadata = {
  title: "Try it — SpeechPrep",
  description:
    "Read your speech out loud once and get back your real timing, what you actually said versus what you wrote, and where it drags. No account needed.",
};

export default function DemoPage() {
  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ background: "var(--color-canvas-white)" }}
    >
      <header
        className="container-x py-5"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
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

      <div className="flex-1 flex justify-center" style={{ padding: "24px 24px 96px" }}>
        <div style={{ width: "100%", maxWidth: 720 }}>
          <DemoClient />
        </div>
      </div>
    </main>
  );
}
