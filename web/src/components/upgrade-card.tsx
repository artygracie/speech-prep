// Inline conversion card. Surfaces in places where the user's intent
// is highest — right after a session, on the speech detail page when
// the free rehearsal is spent — instead of a permanent sidebar counter.
//
// The free tier is ONE full rehearsal, so the ladder has two rungs
// based on `freeSessionsRemaining`:
//   - "firm" (1 left): the user hasn't spent the free rehearsal yet —
//                      set the expectation, don't sell hard
//   - "wall" (0 left): they've seen the full report; sell the Event
//                      Pass on the strength of what just landed
//
// Built as a server component so the Stripe Checkout server actions can
// be called directly from the form `action` prop with no client glue.

import {
  startOneShotCheckout,
  startSubscriptionCheckout,
} from "@/app/app/billing-actions";

type Variant = "firm" | "wall";

type Props = {
  /** From `entitlements.free_sessions_remaining`. */
  freeSessionsRemaining: number;
  /** Speech id, threaded into the Event Pass checkout so the $24 pass
   *  locks to this speech. Optional — the post-session card and detail
   *  page both have it; the recorder gate also has it. */
  speechId?: string;
  /** Where to send the user after a successful checkout. Should be a
   *  same-origin path. Falls back to /app/billing if omitted. */
  returnTo?: string;
  /** Tweaks the headline copy by where the card is shown. */
  context?: "post-session" | "speech-detail" | "recorder-gate";
};

function pickVariant(remaining: number): Variant {
  return remaining <= 0 ? "wall" : "firm";
}

const HEADLINES: Record<Variant, Record<NonNullable<Props["context"]>, string>> = {
  firm: {
    "post-session": "This is what one full rehearsal finds.",
    "speech-detail": "Your free rehearsal is waiting.",
    "recorder-gate": "This one's free — the full rehearsal, the full report.",
  },
  wall: {
    "post-session": "You've seen what one rehearsal finds.",
    "speech-detail": "Your free rehearsal is spent.",
    "recorder-gate": "You'll need a pass to record again.",
  },
};

const SUBHEADS: Record<Variant, string> = {
  firm:
    "One full rehearsal with the complete coach report is on the house. After that, the Event Pass covers this speech — $24 once, 30 days, no subscription.",
  wall:
    "Every note in that report gets sharper with repetition. Your next 30 days of rehearsals: $24, once. Or go unlimited across every speech for $12/mo.",
};

export function UpgradeCard({
  freeSessionsRemaining,
  speechId,
  returnTo,
  context = "post-session",
}: Props) {
  const variant = pickVariant(freeSessionsRemaining);
  const headline = HEADLINES[variant][context];
  const sub = SUBHEADS[variant];

  // Visual weight escalates with the variant. "firm" stays warm and
  // unobtrusive; "wall" goes ink-dark so it reads as a real gate.
  const isWall = variant === "wall";

  return (
    <>
      <style>{`
        .uc-card {
          border-radius: 14px;
          padding: 22px 24px;
          display: grid;
          gap: 18px;
        }
        .uc-card.is-firm {
          background: rgba(251,199,104,0.10);
          border: 1px solid rgba(251,199,104,0.32);
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
            {isWall ? "Keep rehearsing" : "Free rehearsal"}
          </div>
          <h3 className="uc-headline">{headline}</h3>
          <p className="uc-sub" style={{ marginTop: 8 }}>
            {sub}
          </p>
        </div>

        <div className="uc-actions">
          {/* Primary: the Event Pass. Threading speechId ensures the
              pass locks to *this* speech in the webhook. */}
          <form action={startOneShotCheckout}>
            {speechId && <input type="hidden" name="speech_id" value={speechId} />}
            {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
            <button type="submit" className="uc-btn uc-btn-primary">
              Event Pass · $24 once
            </button>
          </form>

          <span className="uc-divider" aria-hidden="true">or</span>

          {/* Secondary: Practiced, for repeat speakers. */}
          <form action={startSubscriptionCheckout}>
            <input type="hidden" name="cadence" value="monthly" />
            {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
            <button type="submit" className="uc-btn uc-btn-secondary">
              Every speech · $12/mo
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
