/**
 * lib/orchestrator.ts — the deterministic eight-module graph behind /api/execute.
 *
 * The core is pure in the CLAUDE.md §7 sense: runAgent maps a prompt to
 * { response, steps } and owns everything the pure modules deferred — the ONE
 * Tracer that threads through every module, and ALL Supabase reads/writes those
 * modules do not do themselves (the version-store lookup that supplies the diff
 * baseline, and the sliced preference fetch that feeds MaterialityJudge). The
 * modules stay contract-bound; the orchestrator wires them.
 *
 * This is a fixed graph with LLM-judgment nodes, NOT a ReAct replanning loop:
 * the sequence of modules is deterministic, but the branches (out-of-scope,
 * needs-paste, baseline vs change, material vs silent) are decided by the
 * modules' typed outputs. Two branches short-circuit before the full pipeline
 * runs, for both correctness and budget (CLAUDE.md §5):
 *
 *   - IntakeRouter says out_of_scope        → friendly decline, stop.
 *   - DocumentResolver says needs_user_paste → ask the user to paste, stop.
 *
 * Node runtime only (Supabase / Pinecone / OpenAI SDKs).
 */

import { Tracer } from "@/lib/trace";
import type { Step } from "@/lib/trace";
import { supabase } from "@/lib/db";
import type { Preference, ClauseClassification } from "@/lib/db";
import type {
  ClauseCaseClassification,
  MaterialityMode,
} from "@/lib/contracts";

import { runIntakeRouter } from "@/lib/modules/intakeRouter";
import { runDocumentResolver } from "@/lib/modules/documentResolver";
import { runClauseExtractor } from "@/lib/modules/clauseExtractor";
import { runCaseClassifier } from "@/lib/modules/caseClassifier";
import { runVersionDiffer } from "@/lib/modules/versionDiffer";
import { runMaterialityJudge } from "@/lib/modules/materialityJudge";
import { runReportComposer } from "@/lib/modules/reportComposer";
import { runStateWriter } from "@/lib/modules/stateWriter";

const VERSIONS_TABLE = "agreement_versions";
const PREFERENCES_TABLE = "preferences";

/** The general (all-category) preference key (§5 fallback hierarchy). */
const GENERAL_CATEGORY = "*";

/** Fallbacks when IntakeRouter cannot name the service/category. These keep the
 *  downstream contracts (which require non-null strings) satisfiable without
 *  crashing; they are the orchestrator's choice, not a module's. */
const UNKNOWN_SERVICE = "Unknown service";
const UNKNOWN_CATEGORY = "general";

/**
 * Run the full agent pipeline for one prompt and return the human-readable
 * response plus the ordered LLM `steps` trace.
 */
export async function runAgent(
  prompt: string,
): Promise<{ response: string; steps: Step[] }> {
  const tracer = new Tracer();

  // --- 1. IntakeRouter: classify + extract. -------------------------------
  const intake = await runIntakeRouter({ prompt }, tracer);

  // Short-circuit: not a ToS/privacy agreement. Don't spend the rest of the
  // pipeline (budget + correctness) on it.
  if (intake.kind === "out_of_scope") {
    return {
      response:
        "This doesn't look like a terms-of-service or privacy agreement, so " +
        "there's nothing for me to review. Paste an agreement (and name the " +
        "service) and I'll break down what agreeing to it means for you.",
      steps: tracer.steps,
    };
  }

  const service = intake.service ?? UNKNOWN_SERVICE;
  const category = intake.category ?? UNKNOWN_CATEGORY;

  // --- 2. DocumentResolver: obtain the agreement text. --------------------
  const resolved = await runDocumentResolver(
    { source: intake.source, inline_text: intake.inline_text, link_url: intake.link_url },
    tracer,
  );

  // Short-circuit: couldn't fetch the linked policy → ask the user to paste.
  if (resolved.needs_user_paste || !resolved.resolved || resolved.text === null) {
    const why = resolved.reason ? ` (${resolved.reason})` : "";
    return {
      response:
        `I couldn't get the agreement text automatically${why}. ` +
        `Please paste the full text of ${service}'s policy and I'll review it.`,
      steps: tracer.steps,
    };
  }

  const rawText = resolved.text;

  // --- 3. ClauseExtractor: segment into meaningful clauses. ---------------
  const { clauses } = await runClauseExtractor(
    { text: rawText, service, category },
    tracer,
  );

  // --- 4. CaseClassifier: clause → ToS;DR case(s) (RAG). ------------------
  const { classifications } = await runCaseClassifier({ clauses, category }, tracer);

  // --- 5. Resolve version + prior baseline from the version store. --------
  //  onboarding  => baseline v0, no prior (as instructed — ignore any history).
  //  change      => new version = latest+1, prior = latest stored classifications.
  //  A change notice for a service we've never seen degrades gracefully to a
  //  baseline (no prior).
  let version: number;
  let prior: ClauseCaseClassification[] | null;

  if (intake.kind === "onboarding") {
    version = 0;
    prior = null;
  } else {
    const latest = await getLatestVersion(service);
    if (latest === null) {
      version = 0;
      prior = null;
    } else {
      version = latest.version + 1;
      prior = latest.classifications;
    }
  }

  // A version with no prior classifications is, for diff/report purposes, a
  // baseline. Deriving the mode from prior presence keeps VersionDiffer's
  // hasPrior, MaterialityJudge's mode, and ReportComposer's framing aligned.
  const mode: MaterialityMode = prior && prior.length > 0 ? "change" : "onboarding";

  // --- 6. VersionDiffer: genuine changes (baseline: everything new). ------
  const diff = await runVersionDiffer({ current: classifications, prior }, tracer);

  // --- 7. Preference slice + MaterialityJudge. ----------------------------
  //  Slice = only the (case × category) rows that apply: the cases actually
  //  involved in the diff, for THIS category plus the general '*' default.
  //  Never the full 236-row table (CLAUDE.md §5).
  const involvedCaseIds = uniqueCaseIds(diff.changes);
  const preferenceSlice = await fetchPreferenceSlice(involvedCaseIds, category);

  const { material } = await runMaterialityJudge(
    { mode, category, changes: diff.changes, preferenceSlice },
    tracer,
  );

  // --- 8. ReportComposer: personalized report, or silent. -----------------
  const composed = await runReportComposer({ service, category, mode, material }, tracer);

  // --- 9. StateWriter: persist the new version + classifications. ---------
  //  Always persisted (even when the report is silent): the version store is the
  //  diff baseline and the subscription list. No preference updates here —
  //  per-point feedback arrives later via the GUI (§7).
  await runStateWriter(
    {
      service,
      category,
      version,
      raw_text: rawText,
      classifications: classifications as unknown as ClauseClassification[],
    },
    tracer,
  );

  // --- 10. Build the human-readable response. -----------------------------
  const response = buildResponse({
    composed,
    mode,
    service,
    version,
    clauseCount: clauses.length,
    materialCount: material.length,
  });

  return { response, steps: tracer.steps };
}

// ---------------------------------------------------------------------------
// Supabase reads the pure modules deferred to the orchestrator.
// ---------------------------------------------------------------------------

/** The latest stored version for a service (highest version number), or null. */
async function getLatestVersion(
  service: string,
): Promise<{ version: number; classifications: ClauseCaseClassification[] } | null> {
  const { data, error } = await supabase
    .from(VERSIONS_TABLE)
    .select("version, classifications")
    .eq("service", service)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Orchestrator: failed to read the latest stored version for "${service}": ${error.message}`,
    );
  }
  if (!data) return null;

  return {
    version: data.version as number,
    classifications: (data.classifications ?? []) as unknown as ClauseCaseClassification[],
  };
}

/** Fetch ONLY the relevant preference rows: the involved cases, in this category
 *  plus the general '*' default. Empty case set ⇒ no query, empty slice. */
async function fetchPreferenceSlice(
  caseIds: string[],
  category: string,
): Promise<Preference[]> {
  if (caseIds.length === 0) return [];

  const categories =
    category === GENERAL_CATEGORY ? [GENERAL_CATEGORY] : [category, GENERAL_CATEGORY];

  const { data, error } = await supabase
    .from(PREFERENCES_TABLE)
    .select("*")
    .in("case_id", caseIds)
    .in("category", categories);

  if (error) {
    throw new Error(`Orchestrator: failed to fetch the preference slice: ${error.message}`);
  }
  return (data ?? []) as Preference[];
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Distinct case_ids referenced by the diff changes (for the preference slice). */
function uniqueCaseIds(changes: { case_id: string | null }[]): string[] {
  const set = new Set<string>();
  for (const c of changes) {
    if (c.case_id) set.add(c.case_id);
  }
  return [...set];
}

/** Turn the pipeline outcome into the single user-facing `response` string. */
function buildResponse(args: {
  composed: { silent: boolean; report: string | null };
  mode: MaterialityMode;
  service: string;
  version: number;
  clauseCount: number;
  materialCount: number;
}): string {
  const { composed, mode, service, version, clauseCount } = args;

  // A report was written → it IS the response.
  if (!composed.silent && composed.report !== null) {
    return composed.report;
  }

  // Silent: nothing material. Give a clear, mode-appropriate message.
  if (mode === "onboarding") {
    return (
      `I recorded ${service} as your baseline (v${version}) and reviewed ` +
      `${clauseCount} clause${clauseCount === 1 ? "" : "s"}. Nothing in these terms ` +
      `stood out as concerning given your current preferences — I'll flag it if a ` +
      `future update changes that.`
    );
  }

  return (
    `I reviewed the updated ${service} terms (now v${version}) and nothing changed ` +
    `that's material to you, so there's nothing you need to act on.`
  );
}