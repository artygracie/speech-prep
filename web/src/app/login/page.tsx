// Magic-link login. The form is a client component so it can show inline
// status; the rest of the page is server-rendered.

import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in — SpeechPrep",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ background: "var(--color-canvas-white)" }}
    >
      <header className="container-x py-5">
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
      </header>

      <div className="flex-1 flex items-center justify-center py-16">
        <div className="w-full max-w-sm container-narrow" style={{ paddingInline: 24 }}>
          <h1 className="text-heading-lg">Sign in.</h1>
          <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
            We&rsquo;ll email you a link. No passwords.
          </p>

          <div className="mt-8">
            <LoginForm />
          </div>

          <p className="text-body-sm mt-10" style={{ color: "var(--color-muted-ash)" }}>
            New here? Just enter your email — we&rsquo;ll create your account on first sign-in.
          </p>
        </div>
      </div>
    </main>
  );
}
