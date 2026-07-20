/**
 * lib/mail/source.ts — the swappable mail-source seam (Phase 6a).
 *
 * The mail-trigger layer (lib/mail/trigger.ts) is a thin front-end to the same
 * core /api/execute uses (runAgent). It must never know WHERE change-notice
 * emails come from. This interface is that seam: the mock source (Phase 6a,
 * lib/mail/mockSource.ts) and the real Gmail source (Phase 6b) both implement
 * MailSource, and the rest of the system only ever talks to this interface.
 *
 * The mail layer is infrastructure: it records NOTHING in the LLM `steps` trace
 * (CLAUDE.md §7). These types are plain data — no LLM, no Supabase specifics.
 */

/** One change-notification email, normalized across sources. */
export interface ChangeNoticeEmail {
  /** Stable, source-unique id. This is the dedup key — see MailSource below. */
  id: string;
  /** Best-guess service name from the sender/subject, or null if unknown. */
  service_hint: string | null;
  subject: string;
  body: string;
  /** ISO 8601 timestamp the email was received. */
  received_at: string;
}

/**
 * A source of change-notice emails.
 *
 * `fetchNewChangeNotices` returns only notices not yet handled; `markProcessed`
 * records that one has been handled so re-polling never reprocesses it (the
 * processed-ledger lives in the source's own store — Supabase for the mock,
 * a label/read-flag for Gmail — so nothing lives in serverless memory,
 * CLAUDE.md §2). Splitting fetch from mark lets the trigger mark a notice
 * processed ONLY after runAgent succeeds, keeping the whole cycle idempotent
 * regardless of which concrete source is wired in.
 */
export interface MailSource {
  /** New (unprocessed) change notices, oldest-relevant first where meaningful. */
  fetchNewChangeNotices(): Promise<ChangeNoticeEmail[]>;
  /** Mark one notice handled so it is never fetched/processed again. */
  markProcessed(id: string): Promise<void>;
}
