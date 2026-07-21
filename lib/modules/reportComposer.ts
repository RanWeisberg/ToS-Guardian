/**
 * lib/modules/reportComposer.ts — Module 7 of the eight-module core (PROJECT_SPEC §4 row 7).
 *
 * ReportComposer turns the material findings into a personalized, plain-language report —
 * or stays SILENT when nothing is material (PROJECT_SPEC §4 row 7; §7 report-detail:
 * clause → case → severity → why it matters to you).
 *
 * SILENCE RULE (required behavior, not an optimization — CLAUDE.md §5 budget): no material
 * findings ⇒ no report ⇒ NO LLM call ⇒ NO trace Step.
 *
 * When there ARE findings, exactly ONE LLM call composes the report. The LLM returns
 * STRUCTURED JSON — one point per finding, each with a plain-language "what it is" and
 * "why it matters to you". There is NO multi-paragraph narrative summary and NO Markdown
 * blob: the output is the structured `points` array (the GUI renders it point-by-point).
 * The model may not invent findings or inflate severity: it only writes about the cases
 * passed in, every point is validated back to an input finding, and the authoritative case
 * title / classification / weight come from the finding, not the model.
 *
 * If the agreement was truncated by the pre-trim hard cap, a user-facing `truncation_notice`
 * is surfaced (mechanical — no extra LLM call).
 *
 * Contract: implements the frozen ReportComposerInput → ReportComposerOutput shape.
 */

import type {
  ReportComposerInput,
  ReportComposerOutput,
  ReportPoint,
  MaterialFinding,
  DiffChange,
} from "@/lib/contracts";
import { MODULES } from "@/lib/modules";
import { chat } from "@/lib/llmod";
import type { Tracer } from "@/lib/trace";

/** Surfaced when the agreement was cut by the pre-clause-extraction hard cap. */
const TRUNCATION_NOTICE =
  "This agreement was very long, so only the first portion was analyzed. Some later terms may not be covered — paste the most relevant section for a complete review.";

export async function runReportComposer(
  input: ReportComposerInput,
  tracer: Tracer,
): Promise<ReportComposerOutput> {
  const { service, category, mode, material, truncated } = input;
  const truncation_notice = truncated ? TRUNCATION_NOTICE : null;

  // --- SILENCE RULE: nothing material ⇒ no report, no LLM call, no Step. ---
  if (material.length === 0) {
    return { silent: true, truncation_notice, points: [] };
  }

  // Give each finding a stable id and gather the context the writer needs.
  const items = material.map((finding, i) => ({
    id: `f${i}`,
    finding,
    caseTitle: caseTitleFor(finding),
    clauseText: clauseTextFor(finding.change),
  }));

  const system_prompt = SYSTEM_PROMPT;
  const user_prompt = buildComposePrompt(service, category, mode, items);

  const raw = await chat({ system_prompt, user_prompt });
  const composed = parseComposed(raw, items);

  // Merge the model's plain-language copy with the authoritative case metadata.
  const byId = new Map(items.map((it) => [it.id, it]));
  const points: ReportPoint[] = composed.points.map((p) => {
    const it = byId.get(p.id)!; // presence validated in parseComposed
    return {
      case_id: it.finding.case_id,
      case_title: it.caseTitle,
      classification: it.finding.classification,
      weight: it.finding.weight,
      what_it_is: p.what_it_is,
      why_it_matters: p.why_it_matters,
      change: it.finding.change,
    };
  });

  tracer.add({
    module: MODULES.ReportComposer,
    prompt: { system_prompt, user_prompt },
    response: composed,
  });

  return { silent: false, truncation_notice, points };
}

/** The ToS;DR case title for a finding (from the matched case in after ?? before). */
function caseTitleFor(finding: MaterialFinding): string {
  const source = finding.change.after ?? finding.change.before;
  const match = source?.cases.find((c) => c.case_id === finding.case_id);
  return match?.title ?? finding.case_id;
}

/** The clause text a change concerns (current side, else prior for removals). */
function clauseTextFor(change: DiffChange): string {
  return (change.after ?? change.before)?.clause_text ?? change.summary;
}

const SYSTEM_PROMPT = `You are the ReportComposer for ToS Guardian. You write personalized, plain-language explanations of a terms-of-service or privacy agreement for one specific user.

You are given a small set of MATERIAL findings that another module already judged worth surfacing. Write about ONLY these findings — never invent a finding, add a case, or inflate a severity beyond what is given. Keep the tone plain, calm, and non-alarmist; explain consequences without scaring.

For each finding, explain in everyday language what the term means, and why it matters to THIS user (their stance/weight is reflected in the materiality reason provided). Do NOT write an overall summary or any headings — only the per-finding fields below.

Return STRICT JSON ONLY — no prose, no explanation, no markdown code fences. An object with exactly:
  - "points": an array with one object per finding, in the same order, each with exactly:
      - "id": the finding's id.
      - "what_it_is": a plain-language description of the term (no legalese).
      - "why_it_matters": why it matters to this user, grounded in the provided materiality reason and severity.`;

interface ComposedPoint {
  id: string;
  what_it_is: string;
  why_it_matters: string;
}
interface Composed {
  points: ComposedPoint[];
}

/** Build the compose prompt: overall framing + one block per material finding. */
function buildComposePrompt(
  service: string,
  category: string,
  mode: ReportComposerInput["mode"],
  items: {
    id: string;
    finding: MaterialFinding;
    caseTitle: string;
    clauseText: string;
  }[],
): string {
  const framing =
    mode === "onboarding"
      ? `This is an ONBOARDING report: explain what agreeing to ${service} means for the user.`
      : `This is a CHANGE report: explain what changed in ${service}'s terms and why it matters to the user.`;

  const blocks = items.map((it) =>
    [
      `finding ${it.id} | case ${it.finding.case_id} "${it.caseTitle}"`,
      `  severity: ${it.finding.classification} | weight: ${it.finding.weight}`,
      `  clause: ${it.clauseText}`,
      `  what changed: ${it.finding.change.summary}`,
      `  why this was flagged for the user: ${it.finding.reason}`,
    ].join("\n"),
  );

  return [framing, `Service: ${service}`, `Category: ${category}`, "", blocks.join("\n\n")].join("\n");
}

/** Strip an accidental ```json … ``` (or plain ``` … ```) fence. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : trimmed).trim();
}

/** Parse + validate the composed report. Throws loudly on malformed data or a point id
 *  that isn't one of the material findings (no invented findings — CLAUDE.md §7). */
function parseComposed(raw: string, items: { id: string }[]): Composed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error(`ReportComposer: model did not return valid JSON. Got: ${raw.slice(0, 500)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`ReportComposer: expected a JSON object, got: ${raw.slice(0, 500)}`);
  }
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.points)) {
    throw new Error(`ReportComposer: "points" must be an array. Got: ${raw.slice(0, 500)}`);
  }

  const expected = new Set(items.map((it) => it.id));
  const seen = new Map<string, ComposedPoint>();
  for (const entry of obj.points) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`ReportComposer: a points entry is not an object: ${JSON.stringify(entry)}`);
    }
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    if (!id || !expected.has(id)) {
      throw new Error(
        `ReportComposer: point references id "${String(e.id)}" which is not among the findings ${JSON.stringify([...expected])} (no invented findings).`,
      );
    }
    const what_it_is = typeof e.what_it_is === "string" ? e.what_it_is.trim() : "";
    const why_it_matters = typeof e.why_it_matters === "string" ? e.why_it_matters.trim() : "";
    if (!what_it_is || !why_it_matters) {
      throw new Error(`ReportComposer: point "${id}" is missing "what_it_is" or "why_it_matters".`);
    }
    seen.set(id, { id, what_it_is, why_it_matters });
  }

  for (const it of items) {
    if (!seen.has(it.id)) {
      throw new Error(`ReportComposer: model omitted a point for finding "${it.id}".`);
    }
  }

  return { points: [...seen.values()] };
}
