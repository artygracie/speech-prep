// Template rendering. These are the words that go to real people about a
// real wedding, so the tests guard the things that would be embarrassing
// rather than the things that are merely wrong.

import { describe, expect, it } from "vitest";
import { renderEmail, isTemplateKey, type TemplateKey } from "./templates";

const ALL_KEYS: TemplateKey[] = [
  "welcome",
  "read_aloud",
  "apply_edits",
  "start_memorizing",
  "drill_weak_section",
  "run_it_through",
  "cold_run",
  "light_run",
  "event_day",
];

const base = {
  speechTitle: "Best man speech for Tom",
  daysUntil: 5,
  actionUrl: "https://speechprep.ai/app/speeches/abc",
  unsubscribeUrl: "https://speechprep.ai/api/unsubscribe?t=tok",
};

describe("renderEmail", () => {
  it("renders every key the nudge engine can emit", () => {
    for (const key of ALL_KEYS) {
      const out = renderEmail(key, base);
      expect(out.subject.length, key).toBeGreaterThan(0);
      expect(out.text, key).toContain(base.actionUrl);
      expect(out.html, key).toContain(base.actionUrl);
    }
  });

  it("puts an unsubscribe link in every email, in both parts", () => {
    // Recurring behavioural mail without this is a spam complaint waiting
    // to happen, and the List-Unsubscribe header alone is not enough.
    for (const key of ALL_KEYS) {
      const out = renderEmail(key, base);
      expect(out.html, key).toContain(base.unsubscribeUrl);
      expect(out.text, key).toContain(base.unsubscribeUrl);
    }
  });

  it("keeps house voice rules: no em-dashes, no exclamation marks", () => {
    for (const key of ALL_KEYS) {
      const out = renderEmail(key, base);
      expect(out.subject + out.text, key).not.toContain("—");
      expect(out.subject, key).not.toContain("!");
    }
  });

  it("asks for exactly one thing", () => {
    for (const key of ALL_KEYS) {
      const out = renderEmail(key, base);
      const links = out.html.match(/<a /g) ?? [];
      // The action, and the unsubscribe. Never a third.
      expect(links.length, key).toBe(2);
    }
  });

  it("escapes a speech title that contains markup", () => {
    const out = renderEmail("read_aloud", {
      ...base,
      speechTitle: '<script>alert("x")</script>',
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("varies the subject by urgency where the copy promises to", () => {
    const far = renderEmail("cold_run", { ...base, daysUntil: 30 });
    const near = renderEmail("cold_run", { ...base, daysUntil: 2 });
    expect(near.subject).not.toBe(far.subject);
    expect(near.subject).toContain("2 days");
  });

  it("handles a speech with no event date", () => {
    for (const key of ALL_KEYS) {
      const out = renderEmail(key, { ...base, daysUntil: null });
      expect(out.subject, key).not.toContain("null");
      expect(out.subject, key).not.toContain("undefined");
      expect(out.text, key).not.toContain("undefined");
    }
  });

  it("says 'today' on the event day rather than 'in 0 days'", () => {
    const out = renderEmail("event_day", { ...base, daysUntil: 0 });
    expect(out.text).toContain("today");
    expect(out.text).not.toContain("0 days");
  });
});

describe("isTemplateKey", () => {
  it("accepts every key the nudge engine emits", () => {
    for (const key of ALL_KEYS) expect(isTemplateKey(key)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTemplateKey("needs_script")).toBe(false);
    expect(isTemplateKey("")).toBe(false);
    expect(isTemplateKey(null)).toBe(false);
    expect(isTemplateKey("constructor")).toBe(false);
  });
});
