/**
 * lib/mail/selectSource.ts — pick the MailSource to drive (Phase 6b wiring).
 *
 * One place decides which concrete MailSource the trigger runs against, so every
 * caller (the mail_check route, cron, any future entry) stays consistent:
 *
 *   GMAIL_REFRESH_TOKEN present  → the real Gmail source (monitoring path live)
 *   otherwise                    → the mock source (tests / demo-injection)
 *
 * The mock is deliberately kept as the fallback: it keeps the demo-injection and
 * test paths working when no mailbox is configured. The trigger itself
 * (lib/mail/trigger.ts) is unchanged and fully source-agnostic — only the
 * instance returned here differs.
 */

import type { MailSource } from "@/lib/mail/source";
import { mockSource } from "@/lib/mail/mockSource";
import { gmailSource } from "@/lib/mail/gmailSource";
import { GMAIL_REFRESH_TOKEN } from "@/lib/config";

/** Which source name the selector would choose (for diagnostics/logging). */
export function selectedSourceName(): "gmail" | "mock" {
  return GMAIL_REFRESH_TOKEN ? "gmail" : "mock";
}

/** The active MailSource: real Gmail when configured, else the mock. */
export function selectMailSource(): MailSource {
  return GMAIL_REFRESH_TOKEN ? gmailSource : mockSource;
}