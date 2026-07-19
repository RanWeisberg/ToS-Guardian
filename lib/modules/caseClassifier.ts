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
 * Contract: implements the frozen CaseClassifierInput → CaseClassifierOutput shape.
 */

import type {
  CaseClassifierInput,
  CaseClassifierOutput,
  ClauseCaseClassification,
  MatchedCase,
  Classification,
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
  const selections = parseSelections(raw, clauses.length);

  // Reconstruct the contract shape from AUTHORITATIVE candidate metadata; the model
  // only supplies which case_id + a confidence. This guarantees no invented cases and
  // keeps title/classification/weight/topic faithful to the taxonomy.
  const byClauseId = new Map(selections.map((s) => [s.clause_id, s]));
  const classifications: ClauseCaseClassification[] = clauses.map((clause, i) => {
    const sel = byClauseId.get(clause.id);
    const map = candidateMaps[i];
    const cases: MatchedCase[] = [];

    if (sel) {
      for (const chosen of sel.cases) {
        const cand = map.get(chosen.case_id);
        if (!cand) {
          throw new Error(
            `CaseClassifier: clause "${clause.id}" was mapped to case_id "${chosen.case_id}", which is not among its candidates ${JSON.stringify([...map.keys()])} (no invented cases).`,
          );
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

/** Parse + validate the batched judgment into per-clause selections. Throws loudly on
 *  malformed data (no silent fallback — CLAUDE.md §7). */
function parseSelections(raw: string, expectedCount: number): Selection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error(`CaseClassifier: model did not return valid JSON. Got: ${raw.slice(0, 500)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`CaseClassifier: expected a JSON array, got: ${raw.slice(0, 500)}`);
  }
  if (parsed.length !== expectedCount) {
    throw new Error(
      `CaseClassifier: model returned ${parsed.length} clause results but ${expectedCount} clauses were sent.`,
    );
  }

  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`CaseClassifier: result at index ${index} is not an object.`);
    }
    const obj = item as Record<string, unknown>;
    const clause_id = obj.clause_id;
    if (typeof clause_id !== "string" || clause_id.trim().length === 0) {
      throw new Error(`CaseClassifier: result at index ${index} has a missing/invalid "clause_id".`);
    }
    const rawCases = obj.cases;
    if (!Array.isArray(rawCases)) {
      throw new Error(`CaseClassifier: clause "${clause_id}" has a non-array "cases".`);
    }
    const cases = rawCases.map((c) => {
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        throw new Error(`CaseClassifier: clause "${clause_id}" has a non-object case entry.`);
      }
      const co = c as Record<string, unknown>;
      const case_id = co.case_id;
      if (typeof case_id !== "string" || case_id.trim().length === 0) {
        throw new Error(`CaseClassifier: clause "${clause_id}" has a case with a missing "case_id".`);
      }
      const confidence = typeof co.confidence === "number" ? co.confidence : Number(co.confidence);
      if (!Number.isFinite(confidence)) {
        throw new Error(
          `CaseClassifier: clause "${clause_id}", case "${case_id}" has a non-numeric "confidence".`,
        );
      }
      return { case_id: case_id.trim(), confidence: clamp01(confidence) };
    });
    return { clause_id: clause_id.trim(), cases };
  });
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
