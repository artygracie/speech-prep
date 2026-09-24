"use client";

// Records the user's IANA timezone once per session.
//
// The lifecycle sweep sends at 19:00 *local* (the research rationale is
// practising a few hours before sleep). Without a zone we would send every
// user at one server hour, which makes the timing claim false. The browser
// is the only place this is known, so it is captured on first authenticated
// paint and written through a tiny server action.
//
// Renders nothing, and a failure is silent: the sweep falls back to a
// default zone, so a missing value degrades timing rather than breaking
// delivery.

import { useEffect, useRef } from "react";
import { saveTimezone } from "./timezone-action";

const STORAGE_KEY = "sp_tz_synced";

export function CaptureTimezone() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone) return;

    // Only write when it has actually changed. Someone who travels should
    // update; everyone else should cost one localStorage read per session.
    try {
      if (localStorage.getItem(STORAGE_KEY) === zone) return;
    } catch {
      /* private mode — fall through and just write */
    }

    void saveTimezone(zone)
      .then(() => {
        try {
          localStorage.setItem(STORAGE_KEY, zone);
        } catch {
          /* nothing to cache */
        }
      })
      .catch(() => {
        /* timing degrades to the default zone; never surface this */
      });
  }, []);

  return null;
}
