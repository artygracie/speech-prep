import { describe, expect, it } from "vitest";
import { recordingExpiresAt } from "./retention";

describe("recordingExpiresAt", () => {
  it("expires 30 days after the end of the event day", () => {
    expect(recordingExpiresAt("2026-10-10", "2026-10-01T12:00:00Z").toISOString()).toBe(
      "2026-11-09T23:59:59.000Z",
    );
  });

  it("expires 90 days after the take when there is no event date", () => {
    expect(recordingExpiresAt(null, "2026-10-01T12:00:00Z").toISOString()).toBe(
      "2026-12-30T12:00:00.000Z",
    );
  });

  it("falls back to the take date when the event date is malformed", () => {
    expect(recordingExpiresAt("soon", "2026-10-01T12:00:00Z").toISOString()).toBe(
      "2026-12-30T12:00:00.000Z",
    );
  });
});
