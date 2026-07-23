/**
 * lib/contracts.ts — the typed input/output contract for each of the eight core
 * modules, plus the /api/execute envelope types. TYPES ONLY — no implementations.
 *
 * This is the interface spec later phases implement against (CLAUDE.md §7:
 * "typed contracts first"). Each module has a typed input and output and never
 * reaches around its contract to touch another module's internals. Shapes are
 * grounded in PROJECT_SPEC.md §4 (the eight modules) and §5 (the three stores).
 */

import type { Step } from "@/lib/trace";
import type { CaseMatch } from "@/lib/pinecone";
import type { Preference, ClauseClassification } from "@/lib/db";

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** How the input arrived / what the agent should do with it (IntakeRouter). */
export type IntakeKind = "onboarding" | "change_notice" | "out_of_scope";

/** Whether the agreement text is present inline or behind a link. */
export type DocumentSource = "inline" | "linked";

/** ToS;DR case classification severity. */
export type Classification = "good" | "neutral" | "bad" | "blocker";

/** A single meaningful clause segmented out of an agreement (ClauseExtractor). */
export interface Clause {
  id: string;
  text: string;
}

/** One ToS;DR case a clause was mapped to (CaseClassifier output detail). */
export interface MatchedCase {
  case_id: string;
  title: string;
  classification: Classification;
  weight: number;
  topic: string;
  /** The classifier's confidence that this clause maps to this case, 0–1. */
  confidence: number;
}

/** A clause together with the case(s) it maps to. This is the unit persisted in
 *  `agreement_versions.classifications` and re-flagged when preferences change. */
export interface ClauseCaseClassification {
  clause_id: string;
  clause_text: string;
  cases: MatchedCase[];
}

// ---------------------------------------------------------------------------
// 1. IntakeRouter — classify input, extract service + category, detect source
// ---------------------------------------------------------------------------

export interface IntakeRouterInput {
  /** The raw user request or extracted mail content. */
  prompt: string;
}

export interface IntakeRouterOutput {
  kind: IntakeKind;
  service: string | null;
  category: string | null;
  source: DocumentSource;
  /** Agreement text when it arrived inline; null when only a link is present. */
  inline_text: string | null;
  /** Policy link when the agreement is linked; null when it's inline. */
  link_url: string | null;
}

// ---------------------------------------------------------------------------
// 2. DocumentResolver — fetch linked policy text, or ask the user to paste
// ---------------------------------------------------------------------------

export interface DocumentResolverInput {
  source: DocumentSource;
  inline_text: string | null;
  link_url: string | null;
}

export interface DocumentResolverOutput {
  /** True when full agreement text is available in `text`. */
  resolved: boolean;
  text: string | null;
  /** True when the link was unreachable (login-walled, etc.) and the user must
   *  paste the text instead. */
  needs_user_paste: boolean;
  /** Human-readable reason when unresolved; null on success. */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// 3. ClauseExtractor — segment into meaningful clauses, drop boilerplate
// ---------------------------------------------------------------------------

export interface ClauseExtractorInput {
  text: string;
  service: string;
  category: string;
}

export interface ClauseExtractorOutput {
  clauses: Clause[];
}

// ---------------------------------------------------------------------------
// 4. CaseClassifier — embed clauses, query Pinecone, map to ToS;DR case(s)
// ---------------------------------------------------------------------------

export interface CaseClassifierInput {
  clauses: Clause[];
  category: string;
}

export interface CaseClassifierOutput {
  classifications: ClauseCaseClassification[];
}

/** Re-exported so implementers of CaseClassifier can type the raw Pinecone hits
 *  they reason over before committing to MatchedCase. */
export type { CaseMatch };

// ---------------------------------------------------------------------------
// 5. VersionDiffer — isolate genuine changes vs restated terms
// ---------------------------------------------------------------------------

export type ChangeType = "added" | "removed" | "modified" | "unchanged";

export interface DiffChange {
  type: ChangeType;
  case_id: string | null;
  /** Prior clause→case classification, when one existed. */
  before: ClauseCaseClassification | null;
  /** Current clause→case classification, when one exists. */
  after: ClauseCaseClassification | null;
  /** Short description of what changed. */
  summary: string;
}

export interface VersionDifferInput {
  current: ClauseCaseClassification[];
  /** The stored prior version's classifications, or null on first onboarding. */
  prior: ClauseCaseClassification[] | null;
}

export interface VersionDifferOutput {
  /** False on onboarding (no baseline yet) — everything is treated as new. */
  hasPrior: boolean;
  changes: DiffChange[];
}

// ---------------------------------------------------------------------------
// 6. MaterialityJudge — weigh findings against the user's answer context
// ---------------------------------------------------------------------------

/** Onboarding weighs all findings; change-notices weigh only the diff. */
export type MaterialityMode = "onboarding" | "change";

export interface MaterialityJudgeInput {
  mode: MaterialityMode;
  category: string;
  /** On "change" these are diff changes; on "onboarding" the full classification
   *  set is judged as findings. Kept as diff changes for a uniform shape. */
  changes: DiffChange[];
  /** Answered stances for the involved cases, ACROSS ALL services, already
   *  filtered to this category by the orchestrator (§5: user answers enrich the
   *  always-on ToS;DR taxonomy base; the LLM decides only on conflict). A minimal
   *  local shape — deliberately not the db `AnswerRow` type, to keep layering. */
  answerContext: { service: string; case_id: string; stance: "care" | "dont_care" }[];
}

export interface MaterialFinding {
  case_id: string;
  classification: Classification;
  weight: number;
  /** Why this rises to the user's attention, given their preferences. */
  reason: string;
  change: DiffChange;
}

export interface MaterialityJudgeOutput {
  /** Empty when nothing is material — ReportComposer then stays silent. */
  material: MaterialFinding[];
}

// ---------------------------------------------------------------------------
// 7. ReportComposer — produce the personalized report, or stay silent
// ---------------------------------------------------------------------------

export interface ReportComposerInput {
  service: string;
  category: string;
  mode: MaterialityMode;
  material: MaterialFinding[];
  /** True when the agreement was cut by the pre-clause-extraction hard cap
   *  (lib/preprocess/trimAgreement.ts); surfaces a truncation notice. */
  truncated: boolean;
}

/** One structured, user-facing report point: the LLM's plain-language copy
 *  merged with the authoritative case metadata carried by the finding. This
 *  replaces the former single Markdown `report` blob — the GUI renders points. */
export interface ReportPoint {
  case_id: string;
  case_title: string;
  classification: Classification;
  weight: number;
  /** Plain-language description of what the term is. */
  what_it_is: string;
  /** Why it matters to this user, grounded in their preferences. */
  why_it_matters: string;
  change: DiffChange;
}

export interface ReportComposerOutput {
  /** True when nothing was material and no report should be surfaced. */
  silent: boolean;
  /** User-facing notice when the agreement was very long and only the first
   *  portion was analyzed; null when the agreement was not truncated. */
  truncation_notice: string | null;
  /** Structured per-finding points. No narrative Markdown summary is produced. */
  points: ReportPoint[];
}

// ---------------------------------------------------------------------------
// 8. StateWriter — persist the new version, classifications, preference updates
// ---------------------------------------------------------------------------

/** A single preference change learned from user feedback on a report point. */
export interface PreferenceUpdate {
  case_id: string;
  category: string;
  stance: Preference["stance"];
}

export interface StateWriterInput {
  service: string;
  category: string;
  /** 0 for the onboarding baseline, incrementing after (matches schema.sql). */
  version: number;
  raw_text: string;
  classifications: ClauseClassification[];
  /** Optional preference updates from per-point feedback. */
  preferenceUpdates?: PreferenceUpdate[];
}

export interface StateWriterOutput {
  /** The id of the inserted agreement_versions row, or null if nothing written. */
  versionId: number | null;
  written: boolean;
}

// ---------------------------------------------------------------------------
// /api/execute envelope (CLAUDE.md §4)
// ---------------------------------------------------------------------------

export interface ExecuteRequest {
  prompt: string;
}

export interface ExecuteResponse {
  status: "ok" | "error";
  error: string | null;
  response: string | null;
  steps: Step[];
}
