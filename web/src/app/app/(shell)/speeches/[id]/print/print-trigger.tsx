"use client";

// Auto-fires the browser's print dialog on mount, and renders the
// manual "Print / Save as PDF" button. Lives in its own client
// component so the print page itself can stay a server component.

import { useEffect, useRef } from "react";

export function PrintTrigger() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // some browsers throw if blocked; the manual button still works
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.print();
      }}
      style={{
        background: "#111",
        color: "white",
        border: 0,
        borderRadius: 8,
        padding: "8px 14px",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      Print / Save as PDF
    </button>
  );
}
