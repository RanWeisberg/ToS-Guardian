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

/** A stance keyed by (case × category). The `preferences` table it mirrored was
 *  retired in migration 4c; this type is retained only because the frozen
 *  StateWriterInput.preferenceUpdates contract references Preference["stance"]
 *  (via PreferenceUpdate in lib/contracts.ts). No code reads a preferences table. */
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

// The `preferences` table and its helpers were retired in migration step 4c
// (dropped via supabase/drop_preferences.sql). All stance state now lives in the
// `answers` table (see the answers section below). The `Preference` type above is
// retained only because the frozen StateWriterInput.preferenceUpdates contract
// still references Preference["stance"] via PreferenceUpdate (lib/contracts.ts).

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

/** One entry in the Activity Log: an agreement the agent reviewed and what it did. */
export interface ActivityEntry {
  service: string;
  category: string;
  version: number;
  at: string;
  /** The report produced for this service, if any — else null (nothing flagged). */
  reportId: string | null;
  status: "reported" | "silent";
}

/**
 * The full review history (NO LLM): EVERY agreement_versions row (any `active`
 * value — since-unsubscribed services are still part of the history), newest
 * first, left-joined to reports to say what the agent did.
 *
 * Join heuristic (one reports read, matched in memory — no N+1): a report row
 * carries `service` + `created_at` but not a version number, and a report is
 * written in the same run as its version. So we map each version to the most
 * recent report for that service, if any → status 'reported' (+ reportId), else
 * 'silent'. Coarse when a service has multiple versions but only some produced a
 * report (older silent versions then link to the latest report), which is fine
 * for the demo's mostly-single-version services. Throws loudly on error; [] empty.
 */
export async function listActivity(): Promise<ActivityEntry[]> {
  const { data: vData, error: vErr } = await supabase
    .from(VERSIONS_TABLE)
    .select("service, category, version, created_at")
    .order("created_at", { ascending: false });
  if (vErr) {
    throw new Error(`db.listActivity: failed to read versions: ${vErr.message}`);
  }
  const versions = (vData ?? []) as {
    service: string;
    category: string;
    version: number;
    created_at: string;
  }[];
  if (versions.length === 0) return [];

  const { data: rData, error: rErr } = await supabase
    .from(REPORTS_TABLE)
    .select("id, service, created_at")
    .order("created_at", { ascending: false });
  if (rErr) {
    throw new Error(`db.listActivity: failed to read reports: ${rErr.message}`);
  }
  // Most recent report per service (rows are created_at-desc → first seen wins).
  const latestReportByService = new Map<string, string>();
  for (const r of (rData ?? []) as { id: string; service: string; created_at: string }[]) {
    if (!latestReportByService.has(r.service)) latestReportByService.set(r.service, r.id);
  }

  return versions.map((v) => {
    const reportId = latestReportByService.get(v.service) ?? null;
    return {
      service: v.service,
      category: v.category,
      version: v.version,
      at: v.created_at,
      reportId,
      status: reportId ? "reported" : "silent",
    };
  });
}

/**
 * The derived standing-issues view (NO LLM): for each active service's latest
 * version, the PROBLEMATIC (bad|blocker) cases the user still cares about.
 *
 * Stance resolution reads the ANSWER LOG (not preferences), across services, for
 * each involved (case_id × category):
 *   - any answered row with stance='care' → care (it's an issue);
 *   - answered rows all 'dont_care'        → dont_care (user opted out → not an issue);
 *   - NO answered rows                      → ToS;DR severity default (bad|blocker ⇒
 *     care), so a freshly-onboarded service's problematic clauses still surface
 *     before the user has answered anything.
 *
 * Returns only services with >=1 issue. [] when none. Throws loudly on error.
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

  // Involved PROBLEMATIC case_ids + the involved categories (answers has no '*'
  // general default — every row carries a real category).
  const caseIds = new Set<string>();
  const categories = new Set<string>();
  for (const s of perService) {
    categories.add(s.category);
    for (const [caseId, meta] of s.cases) {
      if (PROBLEMATIC_CLASSIFICATIONS.has(meta.classification)) caseIds.add(caseId);
    }
  }
  if (caseIds.size === 0) return [];

  // One answers read for those (case_id × category) pairs, across all services,
  // ANSWERED rows only (stance not null).
  const { data: ansData, error: ansErr } = await supabase
    .from(ANSWERS_TABLE)
    .select("case_id, category, stance")
    .in("case_id", [...caseIds])
    .in("category", [...categories])
    .not("stance", "is", null);
  if (ansErr) {
    throw new Error(`db.computeStandingIssues: failed to read answers: ${ansErr.message}`);
  }
  // Per (case|category): does any answered row say 'care', and is there any row?
  const careKeys = new Set<string>();
  const answeredKeys = new Set<string>();
  for (const a of (ansData ?? []) as { case_id: string; category: string; stance: string }[]) {
    const key = `${a.case_id}|${a.category}`;
    answeredKeys.add(key);
    if (a.stance === "care") careKeys.add(key);
  }

  const result: StandingIssueService[] = [];
  for (const s of perService) {
    const issues: StandingIssue[] = [];
    for (const [caseId, meta] of s.cases) {
      if (!PROBLEMATIC_CLASSIFICATIONS.has(meta.classification)) continue;
      const key = `${caseId}|${s.category}`;
      // any 'care' → care; else if answered → dont_care; else severity default
      // (problematic ⇒ care).
      const cares = careKeys.has(key)
        ? true
        : answeredKeys.has(key)
          ? false
          : PROBLEMATIC_CLASSIFICATIONS.has(meta.classification);
      if (cares) {
        issues.push({ case_id: caseId, title: meta.title, classification: meta.classification });
      }
    }
    if (issues.length > 0) {
      result.push({ service: s.service, category: s.category, issues });
    }
  }
  return result;
}

/** Soft-unsubscribe a service: set active=false on ALL its agreement_versions
 *  rows. Re-subscribe is automatic — StateWriter sets active=true on any new
 *  version (§8). Throws loudly on error (CLAUDE.md §7). */
export async function unsubscribeService(service: string): Promise<void> {
  const { error } = await supabase
    .from(VERSIONS_TABLE)
    .update({ active: false })
    .eq("service", service);
  if (error) {
    throw new Error(`db.unsubscribeService: failed to unsubscribe "${service}": ${error.message}`);
  }
}

/** One tracked service plus how many standing issues it carries. */
export interface ServiceWithIssues extends ActiveService {
  /** Number of care + problematic standing issues (0 when none — still listed). */
  issueCount: number;
}

/** Every active service (newest review first) annotated with its standing-issue
 *  count. Services with 0 issues still appear. [] when nothing is tracked. Throws
 *  loudly on error (CLAUDE.md §7). NO LLM. */
export async function listServicesWithIssueCounts(): Promise<ServiceWithIssues[]> {
  const [services, standing] = await Promise.all([
    listActiveServices(),
    computeStandingIssues(),
  ]);
  const countByService = new Map<string, number>();
  for (const s of standing) countByService.set(s.service, s.issues.length);
  return services.map((s) => ({ ...s, issueCount: countByService.get(s.service) ?? 0 }));
}


// ---------------------------------------------------------------------------
// answers — the answer log (PROJECT_SPEC §5; see supabase/answers.sql).
//
// The single store for stance state (the `preferences` table was retired in
// migration 4c). The answer log is the growing, human-facing record of every
// material clause the user has been shown and how they responded — one row per
// (service × case × category).
// ---------------------------------------------------------------------------

const ANSWERS_TABLE = "answers";

/** A row of `answers`, mirroring supabase/answers.sql column-for-column. */
export interface AnswerRow {
  id: number;
  service: string;
  category: string;
  case_id: string;
  clause: string;
  explanation: string;
  agreement_version: number;
  /** 'care' | 'dont_care', or null until the finding is answered. */
  stance: "care" | "dont_care" | null;
  answered: boolean;
  report_id: string | null;
  created_at: string;
  updated_at: string;
}

/** The fields needed to create/refresh one answer-log row. `stance`/`answered`
 *  are never set here (defaults on insert, preserved on conflict); `id`,
 *  `created_at`, `updated_at` are managed by the schema / upsertAnswerRows. */
export interface NewAnswerRow {
  service: string;
  category: string;
  case_id: string;
  clause: string;
  explanation: string;
  agreement_version: number;
  report_id: string;
}

/**
 * Upsert answer-log rows on the (service, case_id, category) key. No-op on empty.
 *
 * The payload deliberately OMITS `stance` and `answered`, so:
 *   - on INSERT the schema defaults apply (stance=NULL, answered=false); and
 *   - on CONFLICT only the provided provenance columns (clause, explanation,
 *     agreement_version, report_id, updated_at) are updated, leaving any prior
 *     stance/answered intact — a re-review refreshes provenance, never wipes an
 *     answer. Throws loudly on error (CLAUDE.md §7).
 */
export async function upsertAnswerRows(rows: NewAnswerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    service: r.service,
    category: r.category,
    case_id: r.case_id,
    clause: r.clause,
    explanation: r.explanation,
    agreement_version: r.agreement_version,
    report_id: r.report_id,
    updated_at: now,
  }));
  const { error } = await supabase
    .from(ANSWERS_TABLE)
    .upsert(payload, { onConflict: "service,case_id,category" });
  if (error) {
    throw new Error(
      `db.upsertAnswerRows: failed to upsert ${payload.length} answer row(s): ${error.message}`,
    );
  }
}

/** Record a user's answer: set stance + answered=true (+ updated_at) on the row
 *  matching (report_id, case_id). Throws loudly on error (CLAUDE.md §7). */
export async function setAnswer(
  reportId: string,
  caseId: string,
  stance: "care" | "dont_care",
): Promise<void> {
  const { error } = await supabase
    .from(ANSWERS_TABLE)
    .update({ stance, answered: true, updated_at: new Date().toISOString() })
    .eq("report_id", reportId)
    .eq("case_id", caseId);
  if (error) {
    throw new Error(
      `db.setAnswer: failed to set answer for report "${reportId}" case "${caseId}": ${error.message}`,
    );
  }
}

/** All answer-log rows for one report. [] when none. Throws loudly on error. */
export async function getReportAnswerRows(reportId: string): Promise<AnswerRow[]> {
  const { data, error } = await supabase
    .from(ANSWERS_TABLE)
    .select("*")
    .eq("report_id", reportId);
  if (error) {
    throw new Error(
      `db.getReportAnswerRows: failed to read answers for report "${reportId}": ${error.message}`,
    );
  }
  return (data as AnswerRow[] | null) ?? [];
}


/**
 * The judgment read path (§5): the ANSWERED stances (stance not null) for the
 * given case_ids at `category`, ACROSS ALL services. This is what enriches the
 * always-on ToS;DR taxonomy base when MaterialityJudge weighs a case; the LLM
 * decides only when services conflict. [] on empty input. Throws loudly on error.
 */
export async function getAnswerContext(
  caseIds: string[],
  category: string,
): Promise<{ service: string; case_id: string; stance: "care" | "dont_care" }[]> {
  if (caseIds.length === 0) return [];
  const { data, error } = await supabase
    .from(ANSWERS_TABLE)
    .select("service, case_id, stance")
    .eq("category", category)
    .in("case_id", caseIds)
    .not("stance", "is", null);
  if (error) {
    throw new Error(`db.getAnswerContext: failed to read answer context: ${error.message}`);
  }
  return (data ?? []) as {
    service: string;
    case_id: string;
    stance: "care" | "dont_care";
  }[];
}

/** The answered stances for ONE report, as { case_id -> stance } (rows with a
 *  non-null stance only). Pre-fills the report screen. {} when none. Throws
 *  loudly on error (CLAUDE.md §7). */
export async function getReportStances(
  reportId: string,
): Promise<Record<string, "care" | "dont_care">> {
  const rows = await getReportAnswerRows(reportId);
  const map: Record<string, "care" | "dont_care"> = {};
  for (const r of rows) {
    if (r.stance !== null) map[r.case_id] = r.stance;
  }
  return map;
}

/** The service name for a stance the user set directly in the Preferences tab
 *  (not tied to a report). Kept distinct from real services in the answer log. */
export const STANDALONE_ANSWER_SERVICE = "(your preference)";

/** All ANSWERED answer rows (stance not null), newest updated_at first — the
 *  Preferences tab's answer log. [] when none. Throws loudly on error. */
export async function listAnsweredAnswers(): Promise<AnswerRow[]> {
  const { data, error } = await supabase
    .from(ANSWERS_TABLE)
    .select("*")
    .not("stance", "is", null)
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`db.listAnsweredAnswers: failed to read answers: ${error.message}`);
  }
  return (data as AnswerRow[] | null) ?? [];
}

/** Set the stance on EVERY existing answer row for (case_id × category), across
 *  services (flips answered=true, bumps updated_at). Returns how many rows were
 *  updated — 0 means no row exists yet (the caller then writes a standalone one).
 *  Throws loudly on error (CLAUDE.md §7). */
export async function setStanceForCase(
  caseId: string,
  category: string,
  stance: "care" | "dont_care",
): Promise<number> {
  const { data, error } = await supabase
    .from(ANSWERS_TABLE)
    .update({ stance, answered: true, updated_at: new Date().toISOString() })
    .eq("case_id", caseId)
    .eq("category", category)
    .select("id");
  if (error) {
    throw new Error(
      `db.setStanceForCase: failed to set stance for "${caseId}" / "${category}": ${error.message}`,
    );
  }
  return (data ?? []).length;
}

/** Upsert a STANDALONE answer row for a first-time stance set from the Preferences
 *  tab: service=STANDALONE_ANSWER_SERVICE, agreement_version=0, report_id=null,
 *  answered=true. Upsert on (service, case_id, category) so re-adjusting updates
 *  in place. Throws loudly on error (CLAUDE.md §7). */
export async function setStandaloneStance(input: {
  case_id: string;
  category: string;
  clause: string;
  explanation: string;
  stance: "care" | "dont_care";
}): Promise<void> {
  const { error } = await supabase.from(ANSWERS_TABLE).upsert(
    {
      service: STANDALONE_ANSWER_SERVICE,
      category: input.category,
      case_id: input.case_id,
      clause: input.clause,
      explanation: input.explanation,
      agreement_version: 0,
      stance: input.stance,
      answered: true,
      report_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "service,case_id,category" },
  );
  if (error) {
    throw new Error(
      `db.setStandaloneStance: failed to set standalone stance for "${input.case_id}" / "${input.category}": ${error.message}`,
    );
  }
}
