/**
 * lib/modules/clauseExtractor.ts — Module 3 of the eight-module core (PROJECT_SPEC §4).
 *
 * ClauseExtractor segments a full agreement into meaningful, distinct clauses and drops
 * boilerplate (headers, tables of contents, navigation, addresses, filler legalese).
 *
 * Budget-critical rule (CLAUDE.md §5 "batch, don't loop"): the WHOLE agreement goes in
 * a SINGLE LLM call and ALL clauses come back in one response — never one call per
 * paragraph or clause. Exactly one Step is recorded.
 *
 * Contract: implements the frozen ClauseExtractorInput → ClauseExtractorOutput shape
 * from lib/contracts.ts.
 */

import type { ClauseExtractorInput, ClauseExtractorOutput, Clause } from "@/lib/contracts";
import { MODULES } from "@/lib/modules";
import { chat } from "@/lib/llmod";
import type { Tracer } from "@/lib/trace";

const SYSTEM_PROMPT = `You are the ClauseExtractor for ToS Guardian, an agent that reads terms-of-service and privacy agreements. Segment ONE agreement into its meaningful, distinct clauses.

A clause is a self-contained statement of a single term — for example: what rights or licence you grant, what data is collected or shared, cancellation and refund terms, liability and warranty disclaimers, dispute/arbitration terms, and how the terms themselves can change. Each clause should capture one such term so it can be classified on its own.

DROP boilerplate that has no user-facing effect: section headers and titles, tables of contents, navigation/menu text, company addresses and contact blocks, effective-date lines, and pure legalese filler that grants or restricts nothing.

Keep each clause's text FAITHFUL to the source — lightly trim surrounding whitespace and merge a clause that is split across lines, but do NOT paraphrase, summarize, or invent text. If one paragraph states several distinct terms, split it into several clauses; if several lines state one term, join them into one clause.

Return STRICT JSON ONLY — no prose, no explanation, no markdown code fences. The output must be a JSON array of objects, each with exactly:
  - "id": a stable sequential id string, "c1", "c2", "c3", … in reading order.
  - "text": the faithful clause text.

Example shape (illustrative only):
[{"id":"c1","text":"..."},{"id":"c2","text":"..."}]

If the input genuinely contains no meaningful clauses, return an empty array [].`;

export async function runClauseExtractor(
  input: ClauseExtractorInput,
  tracer: Tracer,
): Promise<ClauseExtractorOutput> {
  const system_prompt = SYSTEM_PROMPT;
  const user_prompt = buildUserPrompt(input);

  const raw = await chat({ system_prompt, user_prompt });

  const clauses = parseClauses(raw);
  if (clauses.length === 0) {
    throw new Error(
      `ClauseExtractor: no clauses extracted from the agreement. Raw model output: ${raw.slice(0, 500)}`,
    );
  }

  const output: ClauseExtractorOutput = { clauses };

  tracer.add({
    module: MODULES.ClauseExtractor,
    prompt: { system_prompt, user_prompt },
    response: clauses,
  });

  return output;
}

/** The whole agreement in one prompt (no looping). Service + category give the model
 *  light context for judging what counts as a meaningful term for this kind of service. */
function buildUserPrompt(input: ClauseExtractorInput): string {
  return [
    `Service: ${input.service}`,
    `Category: ${input.category}`,
    "",
    "Agreement text:",
    input.text,
  ].join("\n");
}

/** Strip an accidental ```json … ``` (or plain ``` … ```) fence the model may add. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : trimmed).trim();
}

/** Parse + validate the model output into a Clause[]. Throws loudly on malformed data
 *  (no silent fallback — CLAUDE.md §7). */
function parseClauses(raw: string): Clause[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error(
      `ClauseExtractor: model did not return valid JSON. Got: ${raw.slice(0, 500)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `ClauseExtractor: expected a JSON array of clauses, got: ${raw.slice(0, 500)}`,
    );
  }

  const clauses: Clause[] = [];
  parsed.forEach((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(
        `ClauseExtractor: clause at index ${index} is not an object: ${JSON.stringify(item)}`,
      );
    }
    const obj = item as Record<string, unknown>;
    const id = obj.id;
    const text = obj.text;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error(`ClauseExtractor: clause at index ${index} has a missing or invalid "id".`);
    }
    if (typeof text !== "string") {
      throw new Error(`ClauseExtractor: clause "${id}" has a missing or non-string "text".`);
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) return; // skip empty clauses rather than emit noise
    clauses.push({ id: id.trim(), text: trimmed });
  });

  return clauses;
}
