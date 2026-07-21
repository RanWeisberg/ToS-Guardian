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
import type { ReportPoint, PreferenceUpdate } from "@/lib/contracts";

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

/** Flip a report's lifecycle status (e.g. to 'answered' once feedback is complete). */
export async function setReportStatus(id: string, status: ReportStatus): Promise<void> {
  const { error } = await supabase.from(REPORTS_TABLE).update({ status }).eq("id", id);
  if (error) {
    throw new Error(
      `db.setReportStatus: failed to set report "${id}" to "${status}": ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// preferences — user-preference writes/reads (Phase 7 Step D)
// ---------------------------------------------------------------------------

const PREFERENCES_TABLE = "preferences";

/** The single source of truth for WRITING user preferences: upsert each update
 *  onto the (case_id, category) key with source='user' and updated_at=now().
 *  A no-op for an empty list. Throws loudly on failure (CLAUDE.md §7). */
export async function upsertPreferences(updates: PreferenceUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const rows = updates.map((u) => ({
    case_id: u.case_id,
    category: u.category,
    stance: u.stance,
    source: "user" as const,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from(PREFERENCES_TABLE)
    .upsert(rows, { onConflict: "case_id,category" });
  if (error) {
    throw new Error(
      `db.upsertPreferences: failed to upsert ${rows.length} preference(s): ${error.message}`,
    );
  }
}

/** Of the given case_ids, which already carry a source='user' preference at
 *  `category`. Used to decide whether a report has been fully answered. */
export async function getUserPreferenceCaseIds(
  caseIds: string[],
  category: string,
): Promise<string[]> {
  if (caseIds.length === 0) return [];
  const { data, error } = await supabase
    .from(PREFERENCES_TABLE)
    .select("case_id")
    .eq("category", category)
    .eq("source", "user")
    .in("case_id", caseIds);
  if (error) {
    throw new Error(
      `db.getUserPreferenceCaseIds: failed to read user preferences: ${error.message}`,
    );
  }
  return (data ?? []).map((r) => r.case_id as string);
}

/** The user's already-saved stances for the given case_ids at `category`, as a
 *  { case_id -> stance } map (source='user' rows only). Empty input → empty map
 *  (no query). The value type is Preference["stance"] — i.e. FeedbackStance
 *  ("care" | "dont_care") — expressed here without importing feedback.ts to
 *  avoid a circular import. */
export async function getSavedStances(
  caseIds: string[],
  category: string,
): Promise<Record<string, Preference["stance"]>> {
  if (caseIds.length === 0) return {};
  const { data, error } = await supabase
    .from(PREFERENCES_TABLE)
    .select("case_id, stance")
    .eq("category", category)
    .eq("source", "user")
    .in("case_id", caseIds);
  if (error) {
    throw new Error(`db.getSavedStances: failed to read saved stances: ${error.message}`);
  }
  const map: Record<string, Preference["stance"]> = {};
  for (const row of data ?? []) {
    map[row.case_id as string] = row.stance as Preference["stance"];
  }
  return map;
}
