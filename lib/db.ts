/**
 * lib/db.ts — the app's Supabase client and row types.
 *
 * Creates the service-role Supabase client exactly once (secrets come from
 * lib/config.ts, never process.env directly) and exports it for use across API
 * routes and libraries. Also exports the row types for the two Phase 1 tables,
 * mirroring supabase/schema.sql column-for-column.
 *
 * No queries or business logic live here — just the client and the types.
 * The service-role key bypasses row-level security, so this module must only
 * ever be imported by server-side code (Node runtime), never the browser.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/config";

/**
 * Single shared client. Server-only usage, so we disable session persistence
 * and token auto-refresh (there is no user session — this is the service role).
 */
export const supabase = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** One clause→case classification result, as stored in `classifications`. */
export type ClauseClassification = Record<string, unknown>;

/** A row of `agreement_versions` — the version store / diff baseline. */
export interface AgreementVersion {
  id: number;
  service: string;
  category: string;
  version: number;
  raw_text: string;
  classifications: ClauseClassification[];
  active: boolean;
  created_at: string;
}

/** A user or default preference stance, keyed by (case × category). */
export interface Preference {
  id: number;
  case_id: string;
  category: string;
  stance: "care" | "dont_care";
  source: "default" | "user";
  updated_at: string;
}

/**
 * A row of `mock_inbox` — the Phase 6a mock mailbox (see supabase/mock_inbox.sql).
 * Backs the mock MailSource (lib/mail/mockSource.ts); `processed` is the dedup
 * ledger that keeps re-polling idempotent.
 */
export interface MockInboxRow {
  id: string;
  service_hint: string | null;
  subject: string;
  body: string;
  received_at: string;
  processed: boolean;
}
