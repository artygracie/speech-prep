// Inline conversion card. Surfaces in places where the user's intent
// is highest — right after a session, on the speech detail page when
// they're out of free runs — instead of a permanent sidebar counter.
//
// Three variants based on `freeSessionsRemaining`:
//   - "soft"  (2 left): low-pressure nudge after a successful session
//   - "firm"  (1 left): "this is your last one" — last cheap moment to
//                       commit before the wall
//   - "wall"  (0 left): the user can't record again until they upgrade;
//                       no dismiss, this is the gate
//
// Built as a server component so the Stripe Checkout server actions can
// be called directly from the form `action` prop with no client glue.

import {
  startOneShotCheckout,
  startSubscriptionCheckout,
} from "@/app/app/billing-actions";

type Variant = "soft" | "firm" | "wall";

type Props = {
  /** From `entitlements.free_sessions_remaining`. */
  freeSessionsRemaining: number;
  /** Speech id, threaded into the one-shot checkout so the $19 pass
   *  locks to this speech. Optional — the post-session card and detail
   *  page both have it; the recorder gate also has it. */
  speechId?: string;
  /** Tweaks the headline copy by where the card is shown. */
  context?: "post-session" | "speech-detail" | "recorder-gate";
};

function pickVariant(remaining: number): Variant {
  if (remaining <= 0) return "wall";
  if (remaining === 1) return "firm";
  return "soft";
}

const HEADLINES: Record<Variant, Record<NonNullable<Props["context"]>, string>> = {
  soft: {
    "post-session": "Your second pass usually shows the biggest jump.",
    "speech-detail": "Two free sessions left.",
    "recorder-gate": "Two free sessions left.",
  },
  firm: {
    "post-session": "One free session left after this.",
    "speech-detail": "One free session left.",
    "recorder-gate": "One free session left.",
  },
  wall: {
    "post-session": "You're out of free sessions.",
    "speech-detail": "You're out of free sessions on this account.",
    "recorder-gate": "You'll need to upgrade to record again.",
  },
};

const SUBHEADS: Record<Variant, string> = {
  soft:
    "If this speech matters, lock in unlimited rehearsals across every speech for $12/mo. Or grab a one-off pass if you're only doing this one.",
  firm:
    "Most speakers want the next two or three rehearsals to feel cheap. Go unlimited for $12/mo, or pay $19 once for this speech.",
  wall:
    "Pick a plan to keep practicing. Unlimited is $12/mo across every speech; the single-speech pass is $19, one-time.",
};

export function UpgradeCard({
  freeSessionsRemaining,
  speechId,
  context = "post-session",
}: Props) {
  const variant = pickVariant(freeSessionsRemaining);
  const headline = HEADLINES[variant][context];
  const sub = SUBHEADS[variant];

  // Visual weight escalates with the variant. "soft" stays warm and
  // unobtrusive; "wall" goes ink-dark so it reads as a real gate.
  const isWall = variant === "wall";
  const isFirm = variant === "firm";

  return (
    <>
      <style>{`
        .uc-card {
          border-radius: 14px;
          padding: 22px 24px;
          display: grid;
          gap: 18px;
        }
        .uc-card.is-soft {
          background: rgba(251,199,104,0.10);
          border: 1px solid rgba(251,199,104,0.32);
          color: var(--color-midnight-ink);
        }
        .uc-card.is-firm {
          background: rgba(225,101,64,0.08);
          border: 1px solid rgba(225,101,64,0.24);
          color: var(--color-midnight-ink);
        }
        .uc-card.is-wall {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          border: 1px solid var(--color-midnight-ink);
        }
        .uc-eyebrow {
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--color-muted-ash);
        }
        .uc-card.is-wall .uc-eyebrow { color: rgba(255,255,255,0.6); }
        .uc-headline {
          font-size: 22px; font-weight: 500;
          letter-spacing: -0.015em;
          line-height: 1.25;
          margin-top: 4px;
        }
        .uc-sub {
          font-size: 14px;
          line-height: 1.55;
          color: var(--color-muted-ash);
          max-width: 60ch;
        }
        .uc-card.is-wall .uc-sub { color: rgba(255,255,255,0.72); }
        .uc-actions {
          display: flex; flex-wrap: wrap; gap: 10px;
          align-items: center;
        }
        .uc-btn {
          appearance: none; border: 0;
          padding: 12px 18px;
          border-radius: 10px;
          font-size: 14px; font-weight: 500;
          cursor: pointer;
          display: inline-flex; align-items: center; gap: 8px;
          white-space: nowrap;
          transition: opacity 120ms ease, transform 120ms ease;
        }
        .uc-btn:hover { transform: translateY(-1px); }
        .uc-btn-primary {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
        }
        .uc-card.is-wall .uc-btn-primary {
          background: var(--color-canvas-white);
          color: var(--color-midnight-ink);
        }
        .uc-btn-secondary {
          background: transparent;
          color: var(--color-midnight-ink);
          border: 1px solid rgba(17,17,17,0.18);
        }
        .uc-card.is-wall .uc-btn-secondary {
          color: var(--color-canvas-white);
          border: 1px solid rgba(255,255,255,0.32);
        }
        .uc-btn-ghost {
          background: transparent;
          color: var(--color-muted-ash);
          padding: 12px 8px;
          font-size: 13px;
        }
        .uc-card.is-wall .uc-btn-ghost { color: rgba(255,255,255,0.68); }
        .uc-divider {
          color: var(--color-muted-ash);
          font-size: 13px;
        }
        .uc-card.is-wall .uc-divider { color: rgba(255,255,255,0.5); }
      `}</style>

      <section
        className={`uc-card is-${variant}`}
        aria-label={isWall ? "Upgrade required" : "Upgrade options"}
      >
        <div>
          <div className="uc-eyebrow">
            {isWall ? "Upgrade to keep recording" : isFirm ? "Last free run" : "Free plan"}
          </div>
          <h3 className="uc-headline">{headline}</h3>
          <p className="uc-sub" style={{ marginTop: 8 }}>
            {sub}
          </p>
        </div>

        <div className="uc-actions">
          {/* Primary: Practiced monthly. */}
          <form action={startSubscriptionCheckout}>
            <input type="hidden" name="cadence" value="monthly" />
            <button type="submit" className="uc-btn uc-btn-primary">
              Go unlimited · $12/mo
            </button>
          </form>

          <span className="uc-divider" aria-hidden="true">or</span>

          {/* Secondary: $19 single-speech pass. Threading speechId
              ensures the pass locks to *this* speech in the webhook. */}
          <form action={startOneShotCheckout}>
            {speechId && <input type="hidden" name="speech_id" value={speechId} />}
            <button type="submit" className="uc-btn uc-btn-secondary">
              Just this speech · $19
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
