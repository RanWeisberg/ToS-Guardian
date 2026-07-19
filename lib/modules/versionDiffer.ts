/**
 * lib/modules/versionDiffer.ts — Module 5 of the eight-module core (PROJECT_SPEC §4 row 5).
 *
 * VersionDiffer isolates genuine changes from restated terms by comparing the NEW
 * clause→case classifications against the PRIOR stored version's classifications
 * (PROJECT_SPEC §5: the version store holds the prior classifications, not just raw text).
 *
 * It is "mechanical where possible, LLM for judgment" (CLAUDE.md §5). The mechanical
 * core is a set-difference over the case_ids present now vs before — cheap and needs no
 * LLM. An LLM call is used ONLY for the one thing set-difference can't settle: whether a
 * clause that still maps to the same case but was REWORDED is a material change or merely
 * restated wording. When the diff is mechanically clear, ZERO Steps are recorded.
 *
 * Contract: implements the frozen VersionDifferInput → VersionDifferOutput shape.
 * Baseline (no prior version) is expressed by the contract as hasPrior=false with every
 * current case emitted as "added" (the contract's "everything is treated as new").
 */

import type {
  VersionDifferInput,
  VersionDifferOutput,
  DiffChange,
  ClauseCaseClassification,
  MatchedCase,
} from "@/lib/contracts";
import { MODULES } from "@/lib/modules";
import { chat } from "@/lib/llmod";
import type { Tracer } from "@/lib/trace";

/** Normalize clause text for exact-restatement comparison: case-fold + collapse
 *  whitespace. Different words survive this and route to LLM judgment; pure
 *  whitespace/casing differences are treated as unchanged mechanically. */
function normText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** All info the diff needs about one case_id within a version. */
interface CaseEntry {
  caseId: string;
  /** Representative clause classification carrying this case (for DiffChange before/after). */
  owner: ClauseCaseClassification;
  /** Representative matched-case metadata (title/classification for summaries). */
  matched: MatchedCase;
  /** Normalized texts of every clause that maps to this case in this version. */
  texts: Set<string>;
}

/** Index a version's classifications by case_id (dedup across clauses). */
function indexByCase(classifications: ClauseCaseClassification[]): Map<string, CaseEntry> {
  const map = new Map<string, CaseEntry>();
  for (const cc of classifications) {
    for (const mc of cc.cases) {
      const existing = map.get(mc.case_id);
      if (existing) {
        existing.texts.add(normText(cc.clause_text));
      } else {
        map.set(mc.case_id, {
          caseId: mc.case_id,
          owner: cc,
          matched: mc,
          texts: new Set([normText(cc.clause_text)]),
        });
      }
    }
  }
  return map;
}

/** Set equality over normalized clause texts. */
function sameTexts(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

export async function runVersionDiffer(
  input: VersionDifferInput,
  tracer: Tracer,
): Promise<VersionDifferOutput> {
  const { current, prior } = input;

  // --- Baseline: no prior version. Everything is new; no LLM call. ---
  if (prior === null || prior.length === 0) {
    const currentIdx = indexByCase(current);
    const changes: DiffChange[] = [...currentIdx.values()].map((e) => ({
      type: "added",
      case_id: e.caseId,
      before: null,
      after: e.owner,
      summary: `Baseline: "${e.matched.title}" (${e.matched.classification}) recorded for the first time.`,
    }));
    return { hasPrior: false, changes };
  }

  // --- There is a prior version: mechanical set-difference first. ---
  const currentIdx = indexByCase(current);
  const priorIdx = indexByCase(prior);

  const changes: DiffChange[] = [];
  /** Cases present in both whose wording changed — the only LLM-judgment candidates. */
  const reworded: { caseId: string; before: CaseEntry; after: CaseEntry }[] = [];

  // Added: present now, absent before.
  for (const [caseId, e] of currentIdx) {
    if (!priorIdx.has(caseId)) {
      changes.push({
        type: "added",
        case_id: caseId,
        before: null,
        after: e.owner,
        summary: `New case "${e.matched.title}" (${e.matched.classification}) now applies.`,
      });
    }
  }

  // Removed: present before, absent now.
  for (const [caseId, e] of priorIdx) {
    if (!currentIdx.has(caseId)) {
      changes.push({
        type: "removed",
        case_id: caseId,
        before: e.owner,
        after: null,
        summary: `Case "${e.matched.title}" (${e.matched.classification}) no longer applies.`,
      });
    }
  }

  // Common: same case present in both. Mechanically unchanged if the clause text set is
  // identical; otherwise it was reworded → defer to one batched LLM judgment.
  for (const [caseId, after] of currentIdx) {
    const before = priorIdx.get(caseId);
    if (!before) continue;
    if (sameTexts(before.texts, after.texts)) {
      changes.push({
        type: "unchanged",
        case_id: caseId,
        before: before.owner,
        after: after.owner,
        summary: `Case "${after.matched.title}" carried over unchanged.`,
      });
    } else {
      reworded.push({ caseId, before, after });
    }
  }

  // --- LLM judgment ONLY for reworded cases (skip entirely when none). ---
  if (reworded.length > 0) {
    const verdicts = await judgeReworded(reworded, tracer);
    for (const { caseId, before, after } of reworded) {
      const v = verdicts.get(caseId)!; // presence validated in judgeReworded
      if (v.verdict === "modified") {
        changes.push({
          type: "modified",
          case_id: caseId,
          before: before.owner,
          after: after.owner,
          summary: `Case "${after.matched.title}" was materially changed: ${v.reason}`,
        });
      } else {
        changes.push({
          type: "unchanged",
          case_id: caseId,
          before: before.owner,
          after: after.owner,
          summary: `Case "${after.matched.title}" reworded but equivalent: ${v.reason}`,
        });
      }
    }
  }

  return { hasPrior: true, changes };
}

interface Verdict {
  verdict: "modified" | "unchanged";
  reason: string;
}

const JUDGE_SYSTEM_PROMPT = `You are the VersionDiffer's judgment step for ToS Guardian. Each item below is a single ToS;DR case that appears in BOTH the previous and the updated agreement, but whose clause wording changed. Decide, for each, whether the change is MATERIAL.

- "modified"  = the meaning or the user's rights/obligations actually changed (e.g. a scope widened, a right removed, a time window shortened).
- "unchanged" = the wording was restated, reformatted, or paraphrased with NO real change to what it means for the user.

Judge only the substance for the user; ignore pure wording, ordering, and formatting differences.

Return STRICT JSON ONLY — no prose, no explanation, no markdown code fences. A JSON array with one object per item, in the same order given, each with exactly:
  - "case_id": the item's case_id.
  - "verdict": "modified" or "unchanged".
  - "reason": a short (one sentence) justification.`;

/** One batched LLM call judging all reworded cases; records exactly one Step. */
async function judgeReworded(
  reworded: { caseId: string; before: CaseEntry; after: CaseEntry }[],
  tracer: Tracer,
): Promise<Map<string, Verdict>> {
  const system_prompt = JUDGE_SYSTEM_PROMPT;
  const user_prompt = reworded
    .map(({ caseId, before, after }) => {
      const beforeText = [...before.texts].join(" / ");
      const afterText = [...after.texts].join(" / ");
      return [
        `case_id ${caseId}: "${after.matched.title}"`,
        `  BEFORE: ${beforeText}`,
        `  AFTER:  ${afterText}`,
      ].join("\n");
    })
    .join("\n\n");

  const raw = await chat({ system_prompt, user_prompt });
  const verdicts = parseVerdicts(raw, reworded);

  tracer.add({
    module: MODULES.VersionDiffer,
    prompt: { system_prompt, user_prompt },
    response: [...verdicts.entries()].map(([case_id, v]) => ({ case_id, ...v })),
  });

  return verdicts;
}

/** Strip an accidental ```json … ``` (or plain ``` … ```) fence. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : trimmed).trim();
}

/** Parse + validate the batched verdicts. Throws loudly on malformed data or a case_id
 *  that wasn't among the reworded items (never fabricate a change — CLAUDE.md §7). */
function parseVerdicts(
  raw: string,
  reworded: { caseId: string }[],
): Map<string, Verdict> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error(`VersionDiffer: model did not return valid JSON. Got: ${raw.slice(0, 500)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`VersionDiffer: expected a JSON array of verdicts, got: ${raw.slice(0, 500)}`);
  }

  const expected = new Set(reworded.map((r) => r.caseId));
  const out = new Map<string, Verdict>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`VersionDiffer: a verdict entry is not an object: ${JSON.stringify(item)}`);
    }
    const obj = item as Record<string, unknown>;
    // case_ids are numeric-looking, so the model may echo them as JSON numbers —
    // coerce to string before matching against the (string-keyed) candidate set.
    const case_id =
      typeof obj.case_id === "string"
        ? obj.case_id.trim()
        : typeof obj.case_id === "number" && Number.isFinite(obj.case_id)
          ? String(obj.case_id)
          : "";
    if (!case_id || !expected.has(case_id)) {
      throw new Error(
        `VersionDiffer: verdict references case_id "${String(obj.case_id)}" which is not among the reworded cases ${JSON.stringify([...expected])}.`,
      );
    }
    const verdict = obj.verdict;
    if (verdict !== "modified" && verdict !== "unchanged") {
      throw new Error(
        `VersionDiffer: case "${case_id}" has an invalid verdict "${String(verdict)}" (expected "modified" or "unchanged").`,
      );
    }
    const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
    out.set(case_id, { verdict, reason });
  }

  // Every reworded case must have a verdict — no silent gaps.
  for (const r of reworded) {
    if (!out.has(r.caseId)) {
      throw new Error(`VersionDiffer: model omitted a verdict for reworded case "${r.caseId}".`);
    }
  }

  return out;
}
