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
import type {
  ReportPoint,
  PreferenceUpdate,
  ClauseCaseClassification,
  Classification,
} from "@/lib/contracts";

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

/** All reports still awaiting the user's answers, newest first. Throws loudly on
 *  error (no silent fallback that hides a broken store — CLAUDE.md §7). */
export async function listPendingReports(): Promise<ReportRow[]> {
  const { data, error } = await supabase
    .from(REPORTS_TABLE)
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`db.listPendingReports: failed to list pending reports: ${error.message}`);
  }
  return (data as ReportRow[] | null) ?? [];
}

/** The most recent reports (any status), newest first, capped — for the
 *  Dashboard's recent-activity feed. [] when there are none. Throws loudly on
 *  error (no silent fallback that hides a broken store — CLAUDE.md §7). */
export async function listRecentReports(
  limit = 6,
): Promise<{ id: string; service: string; status: ReportStatus; created_at: string }[]> {
  const { data, error } = await supabase
    .from(REPORTS_TABLE)
    .select("id, service, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`db.listRecentReports: failed to list recent reports: ${error.message}`);
  }
  return (data ?? []) as {
    id: string;
    service: string;
    status: ReportStatus;
    created_at: string;
  }[];
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

/** Every preferences row (defaults + user overrides). [] when none. Throws loudly
 *  on error (no silent fallback — CLAUDE.md §7). Used by the Preferences tab to
 *  resolve each case's stance per category. */
export async function listAllPreferences(): Promise<Preference[]> {
  const { data, error } = await supabase.from(PREFERENCES_TABLE).select("*");
  if (error) {
    throw new Error(`db.listAllPreferences: failed to read preferences: ${error.message}`);
  }
  return (data as Preference[] | null) ?? [];
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

// ---------------------------------------------------------------------------
// agreement_versions — Dashboard read views (Phase 7 Step D). Read-only, no LLM.
// ---------------------------------------------------------------------------

const VERSIONS_TABLE = "agreement_versions";

/** One tracked (active) service, at its latest stored version. */
export interface ActiveService {
  service: string;
  category: string;
  latestVersion: number;
  lastReviewedAt: string;
}

/** One agreement-version event, for the recent-activity feed. */
export interface RecentActivity {
  service: string;
  category: string;
  version: number;
  at: string;
}

/** A problematic case the user cares about, still carried by a service's terms. */
export interface StandingIssue {
  case_id: string;
  title: string;
  classification: Classification;
}

/** A service together with its standing issues (>=1 by construction). */
export interface StandingIssueService {
  service: string;
  category: string;
  issues: StandingIssue[];
}

/**
 * The ToS;DR classifications treated as PROBLEMATIC — the negative severities in
 * the Classification union (lib/contracts.ts: "good" | "neutral" | "bad" |
 * "blocker"). "good"/"neutral" are never standing issues.
 */
const PROBLEMATIC_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  "bad",
  "blocker",
]);

/**
 * Index a version's stored classifications by case_id, keeping one representative
 * title + classification per case (mirrors versionDiffer's indexByCase approach:
 * dedup cases across clauses, first representative wins). Read-only, no LLM.
 */
function indexCaseMeta(
  classifications: ClauseCaseClassification[],
): Map<string, { title: string; classification: Classification }> {
  const map = new Map<string, { title: string; classification: Classification }>();
  for (const cc of classifications) {
    for (const mc of cc.cases ?? []) {
      if (!map.has(mc.case_id)) {
        map.set(mc.case_id, { title: mc.title, classification: mc.classification });
      }
    }
  }
  return map;
}

/** Distinct active services, each at its highest-version row, newest review first.
 *  [] when nothing is tracked. Throws loudly on error (CLAUDE.md §7). */
export async function listActiveServices(): Promise<ActiveService[]> {
  const { data, error } = await supabase
    .from(VERSIONS_TABLE)
    .select("service, category, version, created_at")
    .eq("active", true)
    .order("version", { ascending: false });
  if (error) {
    throw new Error(`db.listActiveServices: failed to read services: ${error.message}`);
  }
  const rows = (data ?? []) as {
    service: string;
    category: string;
    version: number;
    created_at: string;
  }[];

  // Rows are version-desc, so the FIRST row seen per service is its latest version.
  const byService = new Map<string, ActiveService>();
  for (const r of rows) {
    if (!byService.has(r.service)) {
      byService.set(r.service, {
        service: r.service,
        category: r.category,
        latestVersion: r.version,
        lastReviewedAt: r.created_at,
      });
    }
  }
  return [...byService.values()].sort((a, b) =>
    b.lastReviewedAt.localeCompare(a.lastReviewedAt),
  );
}

/** The most recent agreement-version events (any version), newest first, capped.
 *  [] when there's no activity. Throws loudly on error (CLAUDE.md §7). */
export async function listRecentActivity(limit = 6): Promise<RecentActivity[]> {
  const { data, error } = await supabase
    .from(VERSIONS_TABLE)
    .select("service, category, version, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`db.listRecentActivity: failed to read activity: ${error.message}`);
  }
  return ((data ?? []) as {
    service: string;
    category: string;
    version: number;
    created_at: string;
  }[]).map((r) => ({
    service: r.service,
    category: r.category,
    version: r.version,
    at: r.created_at,
  }));
}

/**
 * The derived standing-issues view (NO LLM): for each active service's latest
 * version, the cases whose resolved stance is 'care' AND whose classification is
 * problematic. Stance resolution: a preferences row at (case_id, service.category)
 * wins; else (case_id, '*'); missing is treated as 'dont_care'. Returns only
 * services with >=1 issue. [] when none. Throws loudly on error (CLAUDE.md §7).
 */
export async function computeStandingIssues(): Promise<StandingIssueService[]> {
  const { data, error } = await supabase
    .from(VERSIONS_TABLE)
    .select("service, category, version, classifications")
    .eq("active", true)
    .order("version", { ascending: false });
  if (error) {
    throw new Error(`db.computeStandingIssues: failed to read versions: ${error.message}`);
  }

  interface VRow {
    service: string;
    category: string;
    version: number;
    classifications: ClauseCaseClassification[];
  }
  const rows = (data ?? []) as unknown as VRow[];

  // Latest active version per service (rows are version-desc → first per service).
  const latest = new Map<string, VRow>();
  for (const r of rows) {
    if (!latest.has(r.service)) latest.set(r.service, r);
  }
  if (latest.size === 0) return [];

  const perService = [...latest.values()].map((r) => ({
    service: r.service,
    category: r.category,
    cases: indexCaseMeta(r.classifications ?? []),
  }));

  // One preferences read for every involved (case_id) across the involved
  // categories plus the general '*' default.
  const caseIds = new Set<string>();
  const categories = new Set<string>(["*"]);
  for (const s of perService) {
    categories.add(s.category);
    for (const id of s.cases.keys()) caseIds.add(id);
  }
  if (caseIds.size === 0) return [];

  const { data: prefData, error: prefErr } = await supabase
    .from(PREFERENCES_TABLE)
    .select("case_id, category, stance")
    .in("case_id", [...caseIds])
    .in("category", [...categories]);
  if (prefErr) {
    throw new Error(`db.computeStandingIssues: failed to read preferences: ${prefErr.message}`);
  }
  const stanceByKey = new Map<string, Preference["stance"]>();
  for (const p of (prefData ?? []) as {
    case_id: string;
    category: string;
    stance: Preference["stance"];
  }[]) {
    stanceByKey.set(`${p.case_id}|${p.category}`, p.stance);
  }

  const result: StandingIssueService[] = [];
  for (const s of perService) {
    const issues: StandingIssue[] = [];
    for (const [caseId, meta] of s.cases) {
      // Exact (case, category) wins; else general (case, '*'); else 'dont_care'.
      const stance =
        stanceByKey.get(`${caseId}|${s.category}`) ??
        stanceByKey.get(`${caseId}|*`) ??
        "dont_care";
      if (stance === "care" && PROBLEMATIC_CLASSIFICATIONS.has(meta.classification)) {
        issues.push({ case_id: caseId, title: meta.title, classification: meta.classification });
      }
    }
    if (issues.length > 0) {
      result.push({ service: s.service, category: s.category, issues });
    }
  }
  return result;
}

/** Distinct real service categories (from the version store), sorted. [] when
 *  none. Throws loudly on error (CLAUDE.md §7). These are the categories the
 *  Preferences tab lets the user tune stances for. */
export async function listCategories(): Promise<string[]> {
  const { data, error } = await supabase.from(VERSIONS_TABLE).select("category");
  if (error) {
    throw new Error(`db.listCategories: failed to read categories: ${error.message}`);
  }
  const set = new Set<string>();
  for (const row of (data ?? []) as { category: string }[]) {
    if (row.category) set.add(row.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
