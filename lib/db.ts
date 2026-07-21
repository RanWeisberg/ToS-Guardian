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
import type { ReportPoint } from "@/lib/contracts";

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

// ---------------------------------------------------------------------------
// reports — persisted report records (Phase 7 Step C; see supabase/reports.sql)
// ---------------------------------------------------------------------------

/** Report lifecycle status. Only 'pending' is set today; the answered/feedback
 *  lifecycle is a later step. */
export type ReportStatus = "pending" | "answered";

/** How the run that produced the report was triggered. The manual path sets
 *  'manual'; the mail path will set 'mail' (seam left for later). */
export type ReportSource = "manual" | "mail";

/** A row of `reports`. `points` mirrors ReportComposer's structured output
 *  (ReportPoint[]) verbatim — no invented field names. */
export interface ReportRow {
  id: string;
  service: string;
  category: string;
  points: ReportPoint[];
  truncation_notice: string | null;
  response_line: string;
  status: ReportStatus;
  source: ReportSource;
  created_at: string;
}

/** The fields needed to create a report row. `id`, `status`, and `created_at`
 *  are supplied by insertReport / the schema defaults. */
export interface NewReport {
  service: string;
  category: string;
  points: ReportPoint[];
  truncation_notice: string | null;
  response_line: string;
  source: ReportSource;
}

const REPORTS_TABLE = "reports";

/** Insert one report row and return its generated id. Throws loudly on failure
 *  (no silent fallback that hides a broken store — CLAUDE.md §7). */
export async function insertReport(report: NewReport): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from(REPORTS_TABLE).insert({
    id,
    service: report.service,
    category: report.category,
    points: report.points,
    truncation_notice: report.truncation_notice,
    response_line: report.response_line,
    source: report.source,
    // status defaults to 'pending' in the schema.
  });
  if (error) {
    throw new Error(`db.insertReport: failed to persist report: ${error.message}`);
  }
  return id;
}

/** Fetch one report row by id, or null when no such row exists. */
export async function getReportById(id: string): Promise<ReportRow | null> {
  const { data, error } = await supabase
    .from(REPORTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`db.getReportById: failed to read report "${id}": ${error.message}`);
  }
  return (data as ReportRow | null) ?? null;
}
