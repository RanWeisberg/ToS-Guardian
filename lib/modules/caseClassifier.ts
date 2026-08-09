/**
 * lib/modules/caseClassifier.ts — Module 4, "the RAG core" (PROJECT_SPEC §4 row 4, §5).
 *
 * CaseClassifier maps each extracted clause onto the ToS;DR case taxonomy stored in
 * Pinecone. It is the module the "batch, don't loop" budget rule exists for (CLAUDE.md
 * §5), so every per-item stage is batched:
 *
 *   STEP A — embed ALL clause texts in ONE embed() call (array in, array out).
 *   STEP B — for each clause vector, queryCases() the nearest ToS;DR cases (vector
 *            search, NOT an LLM call — no Step recorded).
 *   STEP C — ONE batched chat() call judges, for every clause at once, which of its
 *            candidate cases it genuinely maps to. The candidates are the RAG grounding:
 *            the model may only SELECT from the case_ids provided, never invent one.
 *
 * Exactly ONE Step is recorded — the STEP C judgment call. Embedding and Pinecone
 * retrieval are not LLM calls and are not part of the trace (CLAUDE.md §4/§7).
 *
 * RECONCILIATION (why there is no array-length check): on a full-length real
 * agreement the batched judgment covers 150+ clauses, and long JSON arrays reliably
 * drift — the model duplicates an id, invents one, or drops one. Matching results to
 * clauses BY POSITION/LENGTH turns that routine drift into a fatal error that throws
 * away an already-paid-for embedding pass and a large completion. So results are
 * reconciled BY clause_id instead (see reconcileClassifications): unknown ids are
 * dropped, duplicates keep the first occurrence, and a clause the model never
 * answered for is emitted with an empty `cases` array — "no known cases matched",
 * which is a legitimate outcome, not an error. Only a completely unusable response
 * (zero surviving entries) still throws. This adds NO extra LLM call and NO retry.
 *
 * Contract: implements the frozen CaseClassifierInput → CaseClassifierOutput shape.
 */

import type {
  CaseClassifierInput,
  CaseClassifierOutput,
  ClauseCaseClassification,
  MatchedCase,
  Classification,
  Clause,
} from "@/lib/contracts";
import type { CaseMatch } from "@/lib/pinecone";
import { MODULES } from "@/lib/modules";
import { chat, embed } from "@/lib/llmod";
import { queryCases } from "@/lib/pinecone";
import type { Tracer } from "@/lib/trace";

/** Nearest cases to retrieve per clause — small, per the budget guidance. */
const TOP_K = 5;

const VALID_CLASSIFICATIONS: readonly Classification[] = ["good", "neutral", "bad", "blocker"];

const SYSTEM_PROMPT = `You are the CaseClassifier for ToS Guardian. You map clauses from a terms-of-service or privacy agreement onto the ToS;DR case taxonomy.

You are given a list of clauses. Each clause comes with a small set of CANDIDATE cases — the nearest matches retrieved from the taxonomy by vector search. For each clause, decide which of ITS candidate cases the clause genuinely expresses.

Rules:
- You may ONLY choose case_ids from that clause's own candidate list. NEVER invent a case_id, and never borrow a candidate from a different clause.
- A clause may map to ZERO cases (none of its candidates truly apply), ONE case, or SEVERAL cases.
- Choose a candidate only when the clause actually states that case's substance — not merely because the topic is similar. Be strict: nearest-neighbour is a hint, not a match.
- For each chosen case give a "confidence" between 0 and 1 for how sure you are the clause expresses that case.

Return STRICT JSON ONLY — no prose, no explanation, no markdown code fences. The output must be a JSON array with one object per clause, in the same order given, each with exactly:
  - "clause_id": the clause's id.
  - "cases": an array of { "case_id": <one of that clause's candidate ids>, "confidence": <number 0-1> }. Use an empty array when no candidate genuinely applies.

Example shape (illustrative only):
[{"clause_id":"c1","cases":[{"case_id":"123","confidence":0.9}]},{"clause_id":"c2","cases":[]}]`;

export async function runCaseClassifier(
  input: CaseClassifierInput,
  tracer: Tracer,
): Promise<CaseClassifierOutput> {
  const { clauses, category } = input;

  if (clauses.length === 0) {
    return { classifications: [] };
  }

  // --- STEP A: batched embedding (one call, never per-clause). ---
  const vectors = await embed(clauses.map((c) => c.text));
  if (vectors.length !== clauses.length) {
    throw new Error(
      `CaseClassifier: embed() returned ${vectors.length} vectors for ${clauses.length} clauses.`,
    );
  }

  // --- STEP B: per-clause vector retrieval (Pinecone, not an LLM call). ---
  const candidatesPerClause: CaseMatch[][] = await Promise.all(
    vectors.map((v) => queryCases(v, TOP_K)),
  );

  // Per-clause lookup: case_id -> authoritative candidate metadata (RAG grounding).
  const candidateMaps = candidatesPerClause.map((cands) => {
    const map = new Map<string, CaseMatch>();
    for (const c of cands) {
      if (c.case_id && !map.has(c.case_id)) map.set(c.case_id, c);
    }
    return map;
  });

  // --- STEP C: one batched judgment call. ---
  const system_prompt = SYSTEM_PROMPT;
  const user_prompt = buildJudgePrompt(clauses, candidatesPerClause, category);

  const raw = await chat({ system_prompt, user_prompt });

  // Reconcile BY clause_id (never by array length), then reconstruct the contract
  // shape from AUTHORITATIVE candidate metadata; the model only supplies which
  // case_id + a confidence. This guarantees no invented cases and keeps
  // title/classification/weight/topic faithful to the taxonomy.
  const classifications = reconcileClassifications(
    clauses,
    parseJsonPayload(raw),
    candidateMaps,
  );

  tracer.add({
    module: MODULES.CaseClassifier,
    prompt: { system_prompt, user_prompt },
    response: classifications,
  });

  return { classifications };
}

/** Build the batched judge prompt: every clause with its own candidate cases (the RAG
 *  grounding). Kept compact to minimize context (CLAUDE.md §5). */
function buildJudgePrompt(
  clauses: CaseClassifierInput["clauses"],
  candidatesPerClause: CaseMatch[][],
  category: string,
): string {
  const blocks = clauses.map((clause, i) => {
    const cands = candidatesPerClause[i];
    const candLines =
      cands.length === 0
        ? "  (no candidates)"
        : cands
            .map(
              (c) =>
                `  - case_id ${c.case_id}: ${c.title} [${c.classification}, topic: ${c.topic}]` +
                (c.description ? ` — ${c.description}` : ""),
            )
            .join("\n");
    return [`Clause ${clause.id}: ${clause.text}`, "Candidates:", candLines].join("\n");
  });

  return [
    `Service category: ${category}`,
    "",
    "For each clause below, select which of its own candidate cases it genuinely expresses.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

interface Selection {
  clause_id: string;
  cases: { case_id: string; confidence: number }[];
}

/** Strip an accidental ```json … ``` (or plain ``` … ```) fence. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : trimmed).trim();
}

/** Parse the raw completion into JSON. Invalid JSON is still fatal — there is nothing
 *  to reconcile if the payload is not JSON at all. */
function parseJsonPayload(raw: string): unknown {
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    throw new Error(`CaseClassifier: model did not return valid JSON. Got: ${raw.slice(0, 500)}`);
  }
}

/**
 * Reconcile the model's batched judgment against the clauses that were SENT — by
 * clause_id, NEVER by array length or position. PURE and exported so it can be
 * exercised with fabricated data and no network call (scripts-ts/smoke_reconcile.ts).
 *
 *   1. Unknown clause_id (hallucinated / malformed extra) → dropped.
 *   2. Duplicate clause_id → first occurrence wins, the rest ignored.
 *   3. Sent clause with no returned entry → emitted with `cases: []`, i.e. "no known
 *      cases matched". That is a legitimate result, not an error.
 *   4. Output stays aligned with `sentClauses`, in the SAME ORDER they were sent.
 *   5. Only a catastrophic response — ZERO usable entries — throws.
 *
 * `candidateMaps` carries the AUTHORITATIVE per-clause Pinecone metadata, positionally
 * aligned with `sentClauses`; a chosen case_id absent from its clause's map is skipped,
 * which is what upholds the "never invent a case_id" guarantee. It defaults to empty so
 * the id-reconciliation logic can be tested standalone; omitting it yields empty `cases`
 * for every clause, so production callers must always pass it.
 */
export function reconcileClassifications(
  sentClauses: Clause[],
  rawResults: unknown,
  candidateMaps: ReadonlyArray<ReadonlyMap<string, CaseMatch>> = [],
): ClauseCaseClassification[] {
  if (sentClauses.length === 0) return [];

  if (!Array.isArray(rawResults)) {
    throw new Error(
      `CaseClassifier: expected a JSON array of clause results, got ${
        rawResults === null ? "null" : typeof rawResults
      }.`,
    );
  }

  const sentIds = new Set(sentClauses.map((c) => c.id));

  // First-write-wins: a duplicated clause_id keeps its FIRST occurrence.
  const bySentId = new Map<string, Selection>();
  let unknownIds = 0;
  let duplicateIds = 0;
  let malformed = 0;

  for (const item of rawResults) {
    const sel = parseSelection(item);
    if (sel === null) {
      malformed += 1;
      continue;
    }
    if (!sentIds.has(sel.clause_id)) {
      unknownIds += 1;
      continue;
    }
    if (bySentId.has(sel.clause_id)) {
      duplicateIds += 1;
      continue;
    }
    bySentId.set(sel.clause_id, sel);
  }

  // Catastrophic only: nothing at all survived, so the model returned nothing usable.
  if (bySentId.size === 0) {
    throw new Error(
      `CaseClassifier: no usable clause results survived reconciliation — ` +
        `${rawResults.length} entries returned for ${sentClauses.length} sent clauses ` +
        `(${unknownIds} unknown clause_id, ${malformed} malformed). ` +
        `The model returned nothing that could be matched to a sent clause.`,
    );
  }

  const unmatched = sentClauses.length - bySentId.size;
  if (
    unknownIds > 0 ||
    duplicateIds > 0 ||
    malformed > 0 ||
    unmatched > 0 ||
    rawResults.length !== sentClauses.length
  ) {
    // Counts ONLY — never clause text, never prompts.
    console.warn(
      `CaseClassifier: reconciled ${rawResults.length} results -> ${sentClauses.length} clauses ` +
        `(dropped ${unknownIds} unknown id, ${duplicateIds} duplicate id, ` +
        `${malformed} malformed, ${unmatched} clauses unmatched)`,
    );
  }

  return sentClauses.map((clause, i) => {
    const sel = bySentId.get(clause.id);
    const map = candidateMaps[i];
    const cases: MatchedCase[] = [];

    if (sel && map) {
      for (const chosen of sel.cases) {
        const cand = map.get(chosen.case_id);
        if (!cand) {
          // Not among this clause's Pinecone candidates → skip it. This upholds the
          // "never invent a case_id" guarantee (a skipped entry is dropped, never
          // fabricated) without aborting the whole run over one bad entry.
          console.warn(
            `CaseClassifier: clause "${clause.id}" — skipping case_id "${chosen.case_id}", not among its candidates ${JSON.stringify([...map.keys()])} (no invented cases).`,
          );
          continue;
        }
        cases.push({
          case_id: cand.case_id,
          title: cand.title,
          classification: toClassification(cand.classification, cand.case_id),
          weight: cand.weight,
          topic: cand.topic,
          confidence: chosen.confidence,
        });
      }
    }

    return { clause_id: clause.id, clause_text: clause.text, cases };
  });
}

/**
 * Parse ONE returned result into a Selection, or null when it is unusable. Returns
 * null instead of throwing: a single junk entry must never abort a run that produced
 * 150 good ones — reconciliation drops it and the clause falls through to `cases: []`.
 */
function parseSelection(item: unknown): Selection | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;

  // Clause ids may be echoed as JSON numbers — coerce rather than drop.
  const rawId = obj.clause_id;
  const clause_id =
    typeof rawId === "string"
      ? rawId.trim()
      : typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : "";
  if (clause_id.length === 0) return null;

  // A non-array "cases" makes this entry unusable; the clause still gets `cases: []`
  // via the unmatched path, so the run continues either way.
  const rawCases = obj.cases;
  if (!Array.isArray(rawCases)) return null;

  // Skip (don't drop the whole entry over) individual malformed case entries — real
  // model output occasionally emits a junk entry, and a clause may legitimately end up
  // with zero matched cases.
  const cases: { case_id: string; confidence: number }[] = [];
  for (const c of rawCases) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      console.warn(
        `CaseClassifier: clause "${clause_id}" — skipping a non-object case entry.`,
      );
      continue;
    }
    const co = c as Record<string, unknown>;
    // ToS;DR case_ids are numeric-looking, so the model may echo them as JSON
    // numbers rather than strings — coerce to string (as VersionDiffer does)
    // instead of dropping an otherwise well-formed entry.
    const case_id =
      typeof co.case_id === "string"
        ? co.case_id.trim()
        : typeof co.case_id === "number" && Number.isFinite(co.case_id)
          ? String(co.case_id)
          : "";
    if (case_id.length === 0) {
      console.warn(
        `CaseClassifier: clause "${clause_id}" — skipping a case entry with a missing/empty "case_id".`,
      );
      continue;
    }
    const confidence = typeof co.confidence === "number" ? co.confidence : Number(co.confidence);
    if (!Number.isFinite(confidence)) {
      console.warn(
        `CaseClassifier: clause "${clause_id}", case "${case_id}" — skipping: non-numeric "confidence".`,
      );
      continue;
    }
    cases.push({ case_id, confidence: clamp01(confidence) });
  }
  return { clause_id, cases };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Validate a taxonomy classification string against the strict contract union. */
function toClassification(value: string, caseId: string): Classification {
  const v = value.trim().toLowerCase();
  if ((VALID_CLASSIFICATIONS as readonly string[]).includes(v)) {
    return v as Classification;
  }
  throw new Error(
    `CaseClassifier: case "${caseId}" has an unexpected classification "${value}" (expected one of ${VALID_CLASSIFICATIONS.join(", ")}).`,
  );
}
