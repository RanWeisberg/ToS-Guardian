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
 * STRUCTURED JSON (an overall summary + one point per finding) which is rendered into the
 * clause-by-clause markdown string the contract's `report: string` field carries — so the
 * GUI can render it point-by-point. The model may not invent findings or inflate severity:
 * it only writes about the cases passed in, and every point is validated back to an input
 * finding.
 *
 * Contract: implements the frozen ReportComposerInput → ReportComposerOutput shape.
 */

import type {
  ReportComposerInput,
  ReportComposerOutput,
  MaterialFinding,
  DiffChange,
} from "@/lib/contracts";
import { MODULES } from "@/lib/modules";
import { chat } from "@/lib/llmod";
import type { Tracer } from "@/lib/trace";

export async function runReportComposer(
  input: ReportComposerInput,
  tracer: Tracer,
): Promise<ReportComposerOutput> {
  const { service, category, mode, material } = input;

  // --- SILENCE RULE: nothing material ⇒ no report, no LLM call, no Step. ---
  if (material.length === 0) {
    return { silent: true, report: null };
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

  const report = renderMarkdown(service, mode, composed, items);

  tracer.add({
    module: MODULES.ReportComposer,
    prompt: { system_prompt, user_prompt },
    response: composed,
  });

  return { silent: false, report };
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

const SYSTEM_PROMPT = `You are the ReportComposer for ToS Guardian. You write a personalized, plain-language report about a terms-of-service or privacy agreement for one specific user.

You are given a small set of MATERIAL findings that another module already judged worth surfacing. Write about ONLY these findings — never invent a finding, add a case, or inflate a severity beyond what is given. Keep the tone plain, calm, and non-alarmist; explain consequences without scaring.

For each finding, explain in everyday language what the term means, and why it matters to THIS user (their stance/weight is reflected in the materiality reason provided). Also write one short overall summary of the report.

Return STRICT JSON ONLY — no prose, no explanation, no markdown code fences. An object with exactly:
  - "summary": a short (1-3 sentence) plain-language overview.
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
  summary: string;
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

  if (typeof obj.summary !== "string" || obj.summary.trim().length === 0) {
    throw new Error(`ReportComposer: missing or empty "summary".`);
  }
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

  return { summary: obj.summary.trim(), points: [...seen.values()] };
}

/** Render the structured report into the clause-by-clause markdown string the contract's
 *  `report` field carries. Case title + severity come from the (authoritative) findings,
 *  not the model, so the trace and the report stay grounded. */
function renderMarkdown(
  service: string,
  mode: ReportComposerInput["mode"],
  composed: Composed,
  items: {
    id: string;
    finding: MaterialFinding;
    caseTitle: string;
  }[],
): string {
  const byId = new Map(items.map((it) => [it.id, it]));
  const heading =
    mode === "onboarding"
      ? `# What agreeing to ${service} means for you`
      : `# What changed in ${service}'s terms — and why it matters`;

  const lines: string[] = [heading, "", composed.summary, ""];

  for (const point of composed.points) {
    const it = byId.get(point.id)!;
    lines.push(`## ${point.what_it_is}`);
    lines.push(
      `- **Maps to:** ${it.caseTitle} (${it.finding.classification}, weight ${it.finding.weight})`,
    );
    lines.push(`- **Why it matters to you:** ${point.why_it_matters}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
