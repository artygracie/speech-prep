// The one place SpeechPrep sends mail from.
//
// Centralised deliberately. PlanSeats lost 89 welcome emails in September
// 2026 because eight separate edge functions each hardcoded their own
// `from` address on an unverified domain, and Resend started refusing them.
// One sender, one verified domain, one place to fix it.
//
// EMAIL_FROM must be on a domain verified in Resend. If it is unset the
// module reports unavailable rather than guessing — a wrong `from` fails
// silently at the provider, which is the worst possible failure mode for
// something nobody is watching.

import "server-only";
import { Resend } from "resend";

export class EmailUnavailableError extends Error {}

export type SendResult = { id: string };

export type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stable id for the recipient, so Resend groups a person's mail. */
  entityRef: string;
  /** Capability URL that unsubscribes in one click, no login. */
  unsubscribeUrl: string;
};

function fromAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new EmailUnavailableError(
      "EMAIL_FROM is not set. It must be an address on a Resend-verified domain.",
    );
  }
  return from;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new EmailUnavailableError("RESEND_API_KEY is not set");

  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: fromAddress(),
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    headers: {
      // Gmail and Yahoo bulk-sender rules require one-click unsubscribe on
      // recurring non-transactional mail. Without both headers this lands
      // in spam at scale regardless of how good the copy is.
      "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-Entity-Ref-ID": args.entityRef,
    },
  });

  if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  if (!data?.id) throw new Error("Resend returned no message id");
  return { id: data.id };
}
