"use client";

// StickyCTA — pinned bottom-right convergence prompt.
//
// When the user scrolls past the Coach card, a slim bar slides up
// from the bottom-right with a "back to coach" anchor. The full
// convergence behavior (pick edits → apply → record) lives in the
// CoachCard itself — this bar just makes sure the user is one click
// from getting back to it after they've scrolled into the diff or
// pacing sections.
//
// Visibility: shown once the Coach card has fully scrolled out of
// view (we use IntersectionObserver against #coach). Hidden until
// the user actually scrolls past, then fades in.
//
// Mobile: anchored to safe-area-inset-bottom so it doesn't collide
// with iOS Safari's bottom toolbar.

import Link from "next/link";
import { useEffect, useState } from "react";
import { MODE_PRIMARY_CTA, type SessionMode } from "@/lib/modes";

export function StickyCTA({
  mode,
  hasCoach,
}: {
  mode: SessionMode;
  // Hide the bar entirely until the coach has landed; otherwise we'd
  // be inviting the user to "apply" before there's anything to apply.
  hasCoach: boolean;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasCoach) return;
    const target = document.getElementById("coach");
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Show the sticky bar once the coach has fully exited the
        // viewport (intersectionRatio === 0 + boundingClientRect.top
        // is negative, meaning we scrolled past it).
        const scrolledPast =
          !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setVisible(scrolledPast);
      },
      { threshold: [0, 0.01] },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasCoach]);

  if (!hasCoach) return null;

  return (
    <>
      <style>{`
        .sticky-cta {
          position: fixed;
          right: 24px;
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          z-index: 40;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 200ms ease, transform 200ms ease;
          pointer-events: none;
        }
        .sticky-cta.is-visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }
        .sticky-cta-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          padding: 12px 18px;
          border-radius: 999px;
          font-size: 13.5px;
          font-weight: 500;
          text-decoration: none;
          box-shadow:
            0 1px 2px rgba(17,17,17,0.18),
            0 12px 32px rgba(17,17,17,0.18);
          transition: transform 120ms ease, box-shadow 120ms ease;
        }
        .sticky-cta-link:hover {
          transform: translateY(-1px);
          box-shadow:
            0 2px 4px rgba(17,17,17,0.22),
            0 16px 36px rgba(17,17,17,0.22);
        }
        .sticky-cta-link::before {
          content: "↑";
          opacity: 0.65;
          font-size: 14px;
        }
        @media (max-width: 720px) {
          .sticky-cta { right: 12px; left: 12px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); }
          .sticky-cta-link { width: 100%; justify-content: center; padding: 14px 18px; }
        }
      `}</style>
      <div
        className={`sticky-cta ${visible ? "is-visible" : ""}`}
        role="region"
        aria-label="Convergence shortcut"
      >
        <Link href="#coach" className="sticky-cta-link">
          {MODE_PRIMARY_CTA[mode]}
        </Link>
      </div>
    </>
  );
}
