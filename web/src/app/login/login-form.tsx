"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { authCallbackUrl } from "@/lib/site";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const [googleState, setGoogleState] = useState<"idle" | "redirecting">("idle");

  // OAuth: Supabase redirects to Google, Google back to /auth/callback with
  // a code, and the callback exchanges it exactly as it does for magic links.
  async function handleGoogle() {
    setGoogleState("redirecting");
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: authCallbackUrl() },
      });
      if (error) throw error;
    } catch (err) {
      setGoogleState("idle");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: authCallbackUrl() },
      });
      if (error) throw error;
      setState("sent");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "sent") {
    return (
      <div
        className="card-bordered"
        style={{ padding: 20, borderColor: "rgba(71,208,150,0.4)" }}
      >
        <p className="text-subheading">Check your inbox.</p>
        <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
          We sent a link to <strong>{email}</strong>. Click it to sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handle} className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleGoogle}
        className="btn-primary justify-center"
        disabled={googleState === "redirecting" || state === "sending"}
        style={{ gap: 10 }}
      >
        <GoogleMark />
        {googleState === "redirecting" ? "Opening Google…" : "Continue with Google"}
      </button>

      <div
        className="text-caption"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "var(--color-muted-ash)",
          margin: "6px 0",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "rgba(17,17,17,0.08)" }} />
        or email me a link
        <span style={{ flex: 1, height: 1, background: "rgba(17,17,17,0.08)" }} />
      </div>

      <label htmlFor="email" className="sr-only">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@yourdomain.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input input-lg"
        disabled={state === "sending"}
      />
      <button
        type="submit"
        className="btn-ghost justify-center"
        disabled={state === "sending" || googleState === "redirecting"}
      >
        {state === "sending" ? "Sending…" : "Send magic link"}
      </button>
      {error && (
        <p className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
          {error}
        </p>
      )}
    </form>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
