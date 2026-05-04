"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
        },
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
      <label htmlFor="email" className="sr-only">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        autoFocus
        placeholder="you@yourdomain.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input input-lg"
        disabled={state === "sending"}
      />
      <button
        type="submit"
        className="btn-primary justify-center"
        disabled={state === "sending"}
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
