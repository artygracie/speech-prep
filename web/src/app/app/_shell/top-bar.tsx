"use client";

// The single piece of chrome for the authed app. Replaces the old
// 240px sidebar with a thin horizontal bar so the workshop (editor /
// recorder / report) gets the full viewport — the user is here for one
// speech, not to navigate a multi-tenant tool.
//
// Three regions:
//   - Brand (left)        → /app dashboard
//   - Speech title (mid)  → dropdown for users who happen to have more
//                            than one speech; quietly invisible for the
//                            common case (one speech)
//   - Status + avatar     → conversion pill (sessions left / plan name)
//                            + Billing / Settings / Sign out menu
//
// Usage status comes from the `entitlements` table (the same source the
// billing page and paywall use) so the pill never disagrees with the
// actual gate.

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type TopBarSpeech = {
  id: string;
  title: string;
  occasion: string | null;
};

export type TopBarPlan = "free" | "practiced" | "single_speech";

type Props = {
  displayName: string;
  email: string;
  plan: TopBarPlan;
  freeSessionsRemaining: number;
  /** All speeches the user owns, freshest first. The bar derives "the
   *  current speech" from the URL (via usePathname) and routes the rest
   *  into the switcher dropdown. */
  speeches: TopBarSpeech[];
  signOut: () => Promise<void>;
};

const FREE_LIMIT = 3;

// /app/speeches/<uuid>/... — pull the id out so the bar can show the
// right speech as "current" no matter which child route we're on.
const SPEECH_PATH_RE = /^\/app\/speeches\/([0-9a-f-]{36})(?:\/|$)/i;

export function TopBar({
  displayName,
  email,
  plan,
  freeSessionsRemaining,
  speeches,
  signOut,
}: Props) {
  const pathname = usePathname();
  const currentSpeechId = pathname?.match(SPEECH_PATH_RE)?.[1] ?? null;
  const currentSpeech = currentSpeechId
    ? speeches.find((s) => s.id === currentSpeechId) ?? null
    : null;
  const otherSpeeches = currentSpeechId
    ? speeches.filter((s) => s.id !== currentSpeechId)
    : speeches;
  const [titleOpen, setTitleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Track which pathname the open dropdowns belong to. If the route
  // changes underneath us, we close them in render — cleaner than a
  // useEffect that fires setState during commit.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  if (openedAt !== null && openedAt !== pathname) {
    setTitleOpen(false);
    setMenuOpen(false);
    setOpenedAt(null);
  }
  const titleRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (titleOpen && titleRef.current && !titleRef.current.contains(e.target as Node)) {
        setTitleOpen(false);
      }
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setTitleOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [titleOpen, menuOpen]);

  const initial = (displayName || email || "?").trim().charAt(0).toUpperCase();
  const isPaid = plan === "practiced" || plan === "single_speech";
  // Sessions-left pill — escalates colour as the user gets closer to
  // the wall so conversion intent rises with the visual weight.
  const sessionsLeft = Math.max(0, freeSessionsRemaining);
  const pillTone =
    sessionsLeft === 0 ? "danger" : sessionsLeft <= 1 ? "warn" : "neutral";

  return (
    <>
      <style>{`
        .tb {
          position: sticky; top: 0; z-index: 40;
          height: 52px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 16px;
          padding: 0 20px;
          background: rgba(255,255,255,0.85);
          backdrop-filter: saturate(180%) blur(14px);
          -webkit-backdrop-filter: saturate(180%) blur(14px);
          border-bottom: 1px solid rgba(17,17,17,0.06);
        }
        .tb-brand {
          display: inline-flex; align-items: center;
          padding: 4px 6px;
          border-radius: 8px;
        }
        .tb-brand:hover { background: rgba(17,17,17,0.04); }

        /* Speech title cluster — the centerpiece. Truncates gracefully. */
        .tb-title-wrap { position: relative; min-width: 0; }
        .tb-title-btn {
          appearance: none; border: 0; background: transparent;
          display: inline-flex; align-items: center; gap: 8px;
          max-width: 100%;
          padding: 6px 10px;
          border-radius: 8px;
          cursor: pointer;
          color: var(--color-midnight-ink);
          text-align: left;
        }
        .tb-title-btn:hover { background: rgba(17,17,17,0.04); }
        .tb-title-btn:disabled { cursor: default; }
        .tb-title-btn:disabled:hover { background: transparent; }
        .tb-title-text {
          display: flex; flex-direction: column;
          min-width: 0;
        }
        .tb-title-main {
          font-size: 14px; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 360px;
        }
        .tb-title-sub {
          font-size: 11px; letter-spacing: 0.04em;
          color: var(--color-muted-ash);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 360px;
        }
        .tb-caret {
          width: 14px; height: 14px; flex-shrink: 0;
          color: var(--color-muted-ash);
          transition: transform 140ms ease;
        }
        .tb-title-btn[aria-expanded="true"] .tb-caret { transform: rotate(180deg); }

        /* Right cluster — pill + avatar. */
        .tb-right { display: inline-flex; align-items: center; gap: 10px; }
        .tb-pill {
          display: inline-flex; align-items: center; gap: 6px;
          height: 30px; padding: 0 11px;
          border-radius: 999px;
          font-size: 12px; font-weight: 500;
          letter-spacing: 0.01em;
          white-space: nowrap;
          text-decoration: none;
          transition: background 140ms ease, color 140ms ease;
        }
        .tb-pill .tb-pill-dot {
          width: 6px; height: 6px; border-radius: 999px;
          flex-shrink: 0;
        }
        .tb-pill.is-neutral {
          background: rgba(17,17,17,0.05);
          color: var(--color-midnight-ink);
        }
        .tb-pill.is-neutral .tb-pill-dot { background: var(--color-deliver-green); }
        .tb-pill.is-neutral:hover { background: rgba(17,17,17,0.08); }
        .tb-pill.is-warn {
          background: rgba(251,199,104,0.22);
          color: #5a4310;
        }
        .tb-pill.is-warn .tb-pill-dot { background: var(--color-engagement-gold); }
        .tb-pill.is-warn:hover { background: rgba(251,199,104,0.32); }
        .tb-pill.is-danger {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
        }
        .tb-pill.is-danger .tb-pill-dot { background: var(--color-leadgen-red); }
        .tb-pill.is-danger:hover { background: #000; }
        .tb-pill.is-paid {
          background: rgba(71,208,150,0.14);
          color: #0d4a30;
        }
        .tb-pill.is-paid .tb-pill-dot { background: var(--color-deliver-green); }

        /* Avatar button. */
        .tb-avatar-wrap { position: relative; }
        .tb-avatar {
          appearance: none; border: 0;
          width: 32px; height: 32px;
          border-radius: 999px;
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          font-size: 13px; font-weight: 600;
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: transform 120ms ease, box-shadow 120ms ease;
        }
        .tb-avatar:hover { transform: scale(1.05); box-shadow: 0 2px 8px rgba(17,17,17,0.18); }

        /* Dropdowns. */
        .tb-pop {
          position: absolute;
          top: calc(100% + 8px);
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          border-radius: 12px;
          box-shadow: 0 8px 28px rgba(17,17,17,0.10);
          min-width: 240px;
          padding: 6px;
          z-index: 50;
          animation: tb-pop-in 120ms ease;
        }
        .tb-pop-title { left: 10px; }
        .tb-pop-menu  { right: 0; }
        @keyframes tb-pop-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .tb-pop-section {
          padding: 6px 10px 4px;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-muted-ash);
        }
        .tb-pop-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          font-size: 14px;
          color: var(--color-midnight-ink);
          text-decoration: none;
          cursor: pointer;
          background: transparent;
          border: 0;
          width: 100%;
          text-align: left;
        }
        .tb-pop-row:hover { background: rgba(17,17,17,0.04); }
        .tb-pop-row svg { flex-shrink: 0; color: var(--color-muted-ash); }
        .tb-pop-row.is-current {
          background: rgba(17,17,17,0.04);
          font-weight: 500;
        }
        .tb-pop-row.is-danger { color: var(--color-leadgen-red); }
        .tb-pop-row.is-danger svg { color: var(--color-leadgen-red); }
        .tb-pop-divider {
          height: 1px;
          background: rgba(17,17,17,0.06);
          margin: 6px 4px;
        }

        .tb-pop-user {
          padding: 10px 12px 8px;
          border-bottom: 1px solid rgba(17,17,17,0.06);
          margin-bottom: 6px;
        }
        .tb-pop-user-name { font-size: 14px; font-weight: 500; }
        .tb-pop-user-email {
          font-size: 12px; color: var(--color-muted-ash);
          margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* Mobile: hide the title sub-line and the pill text (keep dot). */
        @media (max-width: 560px) {
          .tb { padding: 0 12px; }
          .tb-title-sub { display: none; }
          .tb-title-main { max-width: 200px; }
          .tb-pill .tb-pill-text { display: none; }
          .tb-pill { padding: 0 8px; }
        }
      `}</style>

      <header className="tb">
        {/* LEFT — brand */}
        <Link href="/app" aria-label="SpeechPrep — your speeches" className="tb-brand">
          <Image
            src="/assets/Logo.svg"
            alt=""
            width={26}
            height={26}
            style={{ display: "block" }}
            priority
          />
        </Link>

        {/* CENTER — current speech + switcher (only shown when there's
            a current speech; on /app, /billing, /settings the slot is
            intentionally empty so the page header carries the title). */}
        <div className="tb-title-wrap" ref={titleRef}>
          {currentSpeech ? (
            <>
              <button
                type="button"
                className="tb-title-btn"
                aria-haspopup="menu"
                aria-expanded={titleOpen}
                onClick={() => {
                  setTitleOpen((v) => !v);
                  setOpenedAt(pathname);
                }}
              >
                <div className="tb-title-text">
                  <div className="tb-title-main">{currentSpeech.title}</div>
                  {currentSpeech.occasion && (
                    <div className="tb-title-sub">{currentSpeech.occasion}</div>
                  )}
                </div>
                <svg className="tb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {titleOpen && (
                <div className="tb-pop tb-pop-title" role="menu">
                  {otherSpeeches.length > 0 && (
                    <>
                      <div className="tb-pop-section">Switch to</div>
                      {otherSpeeches.map((sp) => (
                        <Link
                          key={sp.id}
                          href={`/app/speeches/${sp.id}`}
                          className="tb-pop-row"
                          onClick={() => setTitleOpen(false)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {sp.title}
                          </span>
                        </Link>
                      ))}
                      <div className="tb-pop-divider" />
                    </>
                  )}
                  <Link
                    href="/app/speeches/new"
                    className="tb-pop-row"
                    onClick={() => setTitleOpen(false)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    New speech
                  </Link>
                  <Link
                    href="/app"
                    className="tb-pop-row"
                    onClick={() => setTitleOpen(false)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                    All speeches
                  </Link>
                </div>
              )}
            </>
          ) : (
            <span />
          )}
        </div>

        {/* RIGHT — conversion pill + avatar menu */}
        <div className="tb-right">
          {isPaid ? (
            <Link href="/app/billing" className="tb-pill is-paid" aria-label="Manage your plan">
              <span className="tb-pill-dot" aria-hidden="true" />
              <span className="tb-pill-text">
                {plan === "practiced" ? "Practiced" : "Single speech pass"}
              </span>
            </Link>
          ) : (
            <Link
              href="/app/billing"
              className={`tb-pill is-${pillTone}`}
              aria-label={
                sessionsLeft === 0
                  ? "Out of free sessions — upgrade"
                  : `${sessionsLeft} of ${FREE_LIMIT} free sessions left`
              }
            >
              <span className="tb-pill-dot" aria-hidden="true" />
              <span className="tb-pill-text">
                {sessionsLeft === 0
                  ? "Go unlimited"
                  : sessionsLeft === 1
                  ? "1 session left"
                  : `${sessionsLeft} sessions left`}
              </span>
            </Link>
          )}

          <div className="tb-avatar-wrap" ref={menuRef}>
            <button
              type="button"
              className="tb-avatar"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account"
              onClick={() => {
                setMenuOpen((v) => !v);
                setOpenedAt(pathname);
              }}
            >
              {initial}
            </button>
            {menuOpen && (
              <div className="tb-pop tb-pop-menu" role="menu">
                <div className="tb-pop-user">
                  <div className="tb-pop-user-name">{displayName}</div>
                  <div className="tb-pop-user-email">{email}</div>
                </div>
                <Link
                  href="/app/billing"
                  className="tb-pop-row"
                  onClick={() => setMenuOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="13" rx="2" />
                    <line x1="2" y1="11" x2="22" y2="11" />
                  </svg>
                  Billing & plan
                </Link>
                <Link
                  href="/app/settings"
                  className="tb-pop-row"
                  onClick={() => setMenuOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </Link>
                <div className="tb-pop-divider" />
                <form action={signOut}>
                  <button type="submit" className="tb-pop-row is-danger">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
