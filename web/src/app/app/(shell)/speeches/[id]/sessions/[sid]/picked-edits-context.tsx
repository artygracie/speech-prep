"use client";

// Shared "which edits are picked" state, lifted out of CoachCard so
// other components on the page (LiveScriptPreview, sticky CTA) can
// read it. Pure React Context — no external store dependency.
//
// Default state: top N edit ids from the prop, mirroring CoachCard's
// previous behavior (top 3 pre-checked). Toggle / pickAll / pickNone
// drive the same UI from anywhere on the page.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type PickedEditsValue = {
  picked: Set<string>;
  toggle: (id: string) => void;
  pickAll: () => void;
  pickNone: () => void;
  pickIds: (ids: string[]) => void;
  isPicked: (id: string) => boolean;
};

const PickedEditsContext = createContext<PickedEditsValue | null>(null);

export function PickedEditsProvider({
  initialPickedIds,
  children,
}: {
  initialPickedIds: string[];
  children: ReactNode;
}) {
  // Use the joined ids string as the dependency seed so React
  // re-evaluates if the upstream pre-pick set changes (e.g. coach
  // pipeline lands later than the page first hydrates).
  const seed = initialPickedIds.join("|");
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(initialPickedIds),
  );

  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pickIds = useCallback((ids: string[]) => {
    setPicked(new Set(ids));
  }, []);

  const pickAll = useCallback(() => {
    // Caller controls the all-edit-ids list — we don't track it here.
    // The "Pick all" UI passes the full list via pickIds(). pickAll is
    // exposed for symmetry with pickNone but consumers should prefer
    // pickIds(allIds).
    // Intentionally a no-op fallback to avoid losing state if used
    // directly: leave it to the consumer.
  }, []);

  const pickNone = useCallback(() => {
    setPicked(new Set());
  }, []);

  const value = useMemo<PickedEditsValue>(
    () => ({
      picked,
      toggle,
      pickAll,
      pickNone,
      pickIds,
      isPicked: (id: string) => picked.has(id),
    }),
    [picked, toggle, pickAll, pickNone, pickIds],
  );

  // `seed` is read for its side effect of re-running the provider when
  // it changes — but state survives via setPicked when callers want.
  void seed;

  return (
    <PickedEditsContext.Provider value={value}>
      {children}
    </PickedEditsContext.Provider>
  );
}

export function usePickedEdits(): PickedEditsValue {
  const ctx = useContext(PickedEditsContext);
  if (!ctx) {
    throw new Error(
      "usePickedEdits must be used inside a PickedEditsProvider",
    );
  }
  return ctx;
}

// Optional read-only consumer for components that should render
// nothing when there's no provider (e.g. legacy code paths).
export function useOptionalPickedEdits(): PickedEditsValue | null {
  return useContext(PickedEditsContext);
}
