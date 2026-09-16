// Lifecycle email copy, one entry per key `nextNudge()` can return, plus
// the welcome.
//
// Voice per the SpeechPrep brand guideline: the coach — encouraging,
// private, exacting. The reader is quietly nervous about a real event with
// a real date. So:
//   * Name the task, don't cheerlead. "Read it once tonight" not "You've
//     got this!"
//   * Specifics over adjectives. A number of minutes beats "a bit".
//   * One link per email. If there were two, neither gets clicked.
//   * No em-dashes, no exclamation marks, no subject-line emoji.
//
// Plain text is authored first and the HTML wraps it, rather than the other
// way round, because these should read like a person wrote them. The HTML
// is deliberately minimal: no images, no columns, no logo lockup. Mail that
// looks like a newsletter gets treated like one.

// Deliberately NOT `server-only`: this module is pure string rendering with
// no secrets and no I/O, and keeping it importable means the copy can be
// unit-tested. The API key lives in ./send, which is server-only.

export type TemplateKey =
  | "welcome"
  | "read_aloud"
  | "apply_edits"
  | "start_memorizing"
  | "drill_weak_section"
  | "run_it_through"
  | "cold_run"
  | "light_run"
  | "event_day";

export type TemplateInput = {
  speechTitle: string;
  /** Whole days until the event, or null when no date is set. */
  daysUntil: number | null;
  /** Deep link to the thing the email is asking them to do. */
  actionUrl: string;
  unsubscribeUrl: string;
};

export type RenderedEmail = {
  subject: string;
  /** The one thing the email asks for. */
  cta: string;
  html: string;
  text: string;
};

type Body = {
  subject: (i: TemplateInput) => string;
  cta: string;
  /** Paragraphs. Kept short on purpose; these are read on a phone. */
  lines: (i: TemplateInput) => string[];
};

function whenPhrase(daysUntil: number | null): string {
  if (daysUntil === null) return "";
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil <= 7) return `in ${daysUntil} days`;
  return `in ${Math.round(daysUntil / 7)} weeks`;
}

const BODIES: Record<TemplateKey, Body> = {
  welcome: {
    subject: () => "Your speech is in. Here is the quickest way to start",
    cta: "Read it out loud once",
    lines: (i) => [
      `You added ${i.speechTitle}.`,
      "The single most useful thing you can do right now is read it out loud once, start to finish, without stopping to fix anything. It takes about as long as the speech.",
      "You will get the real timing, a list of the lines you changed without meaning to, and one thing to work on. Most people find the first read is a minute longer than they guessed.",
    ],
  },

  read_aloud: {
    subject: (i) =>
      i.daysUntil !== null && i.daysUntil <= 7
        ? `${i.speechTitle}: read it out loud tonight`
        : "The first read is the one that tells you most",
    cta: "Read it out loud",
    lines: (i) => [
      `You have not read ${i.speechTitle} out loud yet.`,
      "Reading it in your head tells you almost nothing. It is faster, it never stumbles, and it skips the words you will actually trip on.",
      "One full read, out loud, at the pace you would really use. That is the whole task.",
    ],
  },

  apply_edits: {
    subject: () => "There are a few edits waiting on your last take",
    cta: "See what to change",
    lines: (i) => [
      `Your last read of ${i.speechTitle} turned up some things worth changing.`,
      "Some are lines that ran long. Some are places where what you actually said was better than what you wrote, which is the most useful kind of edit and the easiest to lose.",
      "Worth ten minutes before the next read.",
    ],
  },

  start_memorizing: {
    subject: () => "The script is settled. Time to get off the page",
    cta: "Try it from memory",
    lines: (i) => [
      `${i.speechTitle} is in good shape, and the wording has stopped moving.`,
      "That is the point to stop editing and start getting it into your head. Try a run from memory tonight. It will go badly, and that is the exercise. Finding out where you blank is the fastest way to fix it.",
      "You can keep the script on screen if you need it.",
    ],
  },

  drill_weak_section: {
    subject: () => "One section is doing all the damage",
    cta: "Drill that section",
    lines: (i) => [
      `Across your last few runs of ${i.speechTitle}, the same section keeps coming apart.`,
      "It is worth five minutes on that section alone rather than another full run. Recall is built by trying to remember, not by rereading.",
    ],
  },

  run_it_through: {
    subject: (i) =>
      i.daysUntil !== null && i.daysUntil <= 5
        ? `${whenPhrase(i.daysUntil)}. Run it end to end`
        : "Run it end to end tonight",
    cta: "Run it end to end",
    lines: (i) => [
      `The sections of ${i.speechTitle} are holding on their own now.`,
      "The joins are what break on the day. Run it start to finish tonight without stopping, even when you lose a line, because stopping is the habit you do not want.",
    ],
  },

  cold_run: {
    subject: (i) =>
      i.daysUntil !== null
        ? `${i.speechTitle} is ${whenPhrase(i.daysUntil)}. One cold run`
        : "One cold run, no warm-up",
    cta: "Do a cold run",
    lines: (i) => [
      `You know ${i.speechTitle} well now.`,
      "So make it harder. No warm-up, no reading it through first. Stand up and start, the way it will actually happen, when you have been sitting down through dinner and someone says your name.",
    ],
  },

  light_run: {
    subject: () => "Just keep it warm",
    cta: "Do a light run",
    lines: (i) => [
      `${i.speechTitle} is ready. Genuinely.`,
      "There is nothing left to fix, and more drilling now tends to make people more mechanical rather than better. One easy run every day or two is enough to keep it warm.",
    ],
  },

  event_day: {
    subject: () => "Today. One easy run, then leave it alone",
    cta: "One last run",
    lines: (i) => [
      `${i.speechTitle} is today.`,
      "One relaxed run this morning, out loud, and then put it away. Cramming on the day makes the delivery stiffer, not sharper.",
      "Water before you stand up. Slower than feels natural. Look up at the end of each line. You have done the work.",
    ],
  },
};

const BASE_STYLE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
  "font-size:16px;line-height:1.55;color:#111111;";

function renderHtml(lines: string[], cta: string, actionUrl: string, unsubscribeUrl: string): string {
  const paragraphs = lines
    .map((l) => `<p style="margin:0 0 18px;">${escapeHtml(l)}</p>`)
    .join("");
  return [
    `<div style="${BASE_STYLE}max-width:520px;margin:0 auto;padding:32px 24px;">`,
    paragraphs,
    `<p style="margin:28px 0 0;">`,
    `<a href="${escapeAttr(actionUrl)}" style="display:inline-block;background:#111111;color:#ffffff;`,
    `text-decoration:none;border-radius:8px;padding:13px 20px;font-weight:500;">${escapeHtml(cta)}</a>`,
    `</p>`,
    `<p style="margin:36px 0 0;font-size:13px;color:#6d6c6b;">`,
    `SpeechPrep. <a href="${escapeAttr(unsubscribeUrl)}" style="color:#6d6c6b;">Stop these reminders</a>.`,
    `</p>`,
    `</div>`,
  ].join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function renderEmail(key: TemplateKey, input: TemplateInput): RenderedEmail {
  const body = BODIES[key];
  const lines = body.lines(input);
  return {
    subject: body.subject(input),
    cta: body.cta,
    html: renderHtml(lines, body.cta, input.actionUrl, input.unsubscribeUrl),
    text: [
      ...lines,
      "",
      `${body.cta}: ${input.actionUrl}`,
      "",
      `Stop these reminders: ${input.unsubscribeUrl}`,
    ].join("\n"),
  };
}

export function isTemplateKey(v: unknown): v is TemplateKey {
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so "constructor"
  // and "toString" would both pass and then blow up at render time.
  return typeof v === "string" && Object.hasOwn(BODIES, v);
}
