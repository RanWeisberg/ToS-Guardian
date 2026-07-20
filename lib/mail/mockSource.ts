/**
 * lib/mail/mockSource.ts — the Phase 6a MOCK MailSource.
 *
 * A MailSource backed by the Supabase `mock_inbox` table (supabase/mock_inbox.sql).
 * Drop a "change-notification email" row into that table and the mail-trigger
 * layer picks it up — a stand-in for a real inbox until the Gmail source lands
 * in Phase 6b. Both sources implement the SAME MailSource interface; the trigger
 * never knows which one it is talking to (lib/mail/source.ts).
 *
 * State lives entirely in Supabase (CLAUDE.md §2): `fetchNewChangeNotices` reads
 * the unprocessed rows, `markProcessed` flips `processed=true`. Nothing survives
 * in serverless memory, so re-polling is idempotent.
 *
 * Node runtime only (Supabase SDK). Not part of the LLM `steps` trace.
 */

import { supabase } from "@/lib/db";
import type { MockInboxRow } from "@/lib/db";
import type { ChangeNoticeEmail, MailSource } from "@/lib/mail/source";

const MOCK_INBOX_TABLE = "mock_inbox";

/** Map a raw DB row to the source-agnostic ChangeNoticeEmail. */
function toChangeNotice(row: MockInboxRow): ChangeNoticeEmail {
  return {
    id: row.id,
    service_hint: row.service_hint,
    subject: row.subject,
    body: row.body,
    received_at: row.received_at,
  };
}

export const mockSource: MailSource = {
  async fetchNewChangeNotices(): Promise<ChangeNoticeEmail[]> {
    const { data, error } = await supabase
      .from(MOCK_INBOX_TABLE)
      .select("id, service_hint, subject, body, received_at, processed")
      .eq("processed", false)
      .order("received_at", { ascending: true });

    if (error) {
      throw new Error(`mockSource: failed to read the mock inbox: ${error.message}`);
    }
    return (data ?? []).map((row) => toChangeNotice(row as MockInboxRow));
  },

  async markProcessed(id: string): Promise<void> {
    const { error } = await supabase
      .from(MOCK_INBOX_TABLE)
      .update({ processed: true })
      .eq("id", id);

    if (error) {
      throw new Error(
        `mockSource: failed to mark email "${id}" processed: ${error.message}`,
      );
    }
  },
};
