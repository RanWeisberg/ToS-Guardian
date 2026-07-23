/**
 * lib/modules/materialityJudge.ts — Module 6 of the eight-module core (PROJECT_SPEC §4 row 6).
 *
 * MaterialityJudge weighs the changes/findings against the user's preference slice and the
 * ToS;DR case weights to decide what is worth surfacing (empty ⇒ ReportComposer stays
 * silent).
 *
 * §5 MODEL: the ToS;DR taxonomy is the always-on BASE LAYER — every judgment reasons from a
 * case's severity/weight regardless of user history. The user's prior ANSWERS enrich it.
 * This module stays PURE (input → output, no store I/O, like the other five modules): the
 * orchestrator fetches the answered stances (across services, for this category) and passes
 * them as `answerContext`. Step A resolves each case MECHANICALLY via resolveFromAnswers:
 * no answers → severity default; answers agree → that stance; answers conflict across
 * services → provisional "care" plus the conflicting history, deferred to the judge.
 *
 * Step A is mechanical — no LLM. Step B is exactly ONE LLM judgment call (conflicts are
 * reasoned over inside that same single call — never a second call). Stance resolution is
 * NOT a trace Step.
 */

import type {
  MaterialityJudgeInput,
  MaterialityJudgeOutput,
  MaterialFinding,
  MatchedCase,
  DiffChange,
  Classification,
} from "@/lib/contracts";
import { MODULES } from "@/lib/modules";
import { chat } from "@/lib/llmod";
import type { Tracer } from "@/lib/trace";

type Stance = "care" | "dont_care";

/** One answered stance for a case on some service (already category-filtered). */
type AnswerContextEntry = { service: string; case_id: string; stance: Stance };

/** The resolution of a case's stance from the taxonomy base + any answers. */
export interface ResolvedAnswer {
  stance: Stance;
  source: "answers_agree" | "answers_conflict" | "severity_default";
  /** For source==="answers_conflict": the differing per-service stances the judge
   *  reasons over. Empty for the other sources. */
  conflicts: { service: string; stance: Stance }[];
}

/** One change annotated with the metadata the judgment call reasons over. */
interface AnnotatedItem {
  itemId: string; // stable id "i0", "i1", … for round-tripping through the LLM
  change: DiffChange;
  case_id: string;
  classification: Classification;
  weight: number;
  title: string;
  stance: Stance;
  stanceSource: ResolvedAnswer["source"];
  /** Conflicting per-service history when stanceSource==="answers_conflict". */
  conflicts: { service: string; stance: Stance }[];
}

export async function runMaterialityJudge(
  input: MaterialityJudgeInput,
  tracer: Tracer,
): Promise<MaterialityJudgeOutput> {
  const { mode, category, changes, answerContext } = input;

  // --- STEP A (mechanical): annotate each judgeable change with severity + resolved
  //     stance. "unchanged" carry-overs are not changes to report, and changes without a
  //     resolvable case can't be weighed — both are dropped here (no LLM cost). ---
  const items: AnnotatedItem[] = [];
  changes.forEach((change, i) => {
    if (change.type === "unchanged") return;
    const matched = matchedCaseFor(change);
    if (!matched || !change.case_id) return;
    const { stance, source, conflicts } = resolveFromAnswers(
      change.case_id,
      category,
      matched.classification,
      answerContext,
    );
    items.push({
      itemId: `i${i}`,
      change,
      case_id: change.case_id,
      classification: matched.classification,
      weight: matched.weight,
      title: matched.title,
      stance,
      stanceSource: source,
      conflicts,
    });
  });

  // Nothing to weigh ⇒ nothing material. Skip the LLM call entirely (budget: CLAUDE.md §5).
  if (items.length === 0) {
    return { material: [] };
  }

  // --- STEP B: one batched LLM judgment call. ---
  const system_prompt = SYSTEM_PROMPT;
  const user_prompt = buildJudgePrompt(mode, category, items);

  const raw = await chat({ system_prompt, user_prompt });
  const verdict = parseVerdict(raw, items);

  tracer.add({
    module: MODULES.MaterialityJudge,
    prompt: { system_prompt, user_prompt },
    response: verdict,
  });

  // Build the contract's material[] from the items the judge marked material.
  const byId = new Map(items.map((it) => [it.itemId, it]));
  const material: MaterialFinding[] = [];
  for (const v of verdict.items) {
    if (!v.material) continue;
    const it = byId.get(v.itemId)!; // presence validated in parseVerdict
    material.push({
      case_id: it.case_id,
      classification: it.classification,
      weight: it.weight,
      reason: v.reason,
      change: it.change,
    });
  }

  return { material };
}

/** The matched-case metadata for a change: prefer the current ("after") side, else the
 *  prior ("before") side (for removals). */
function matchedCaseFor(change: DiffChange): MatchedCase | null {
  const source = change.after ?? change.before;
  if (!source || !change.case_id) return null;
  return source.cases.find((c) => c.case_id === change.case_id) ?? null;
}

/**
 * §5 resolution — PURE, no I/O. The ToS;DR severity is the always-on base; the
 * user's answered stances for this case (across services, already category-filtered
 * by the orchestrator) enrich it:
 *   - no answers            → severity default (care iff bad/blocker);
 *   - all present stances equal → that stance (source "answers_agree");
 *   - stances conflict       → provisional "care" (surface-by-default) + the
 *                              conflicting per-service history for Step B (source
 *                              "answers_conflict").
 * `category` is part of the signature for clarity; answerContext is already scoped
 * to it, so resolution filters by case_id only.
 */
export function resolveFromAnswers(
  caseId: string,
  category: string,
  classification: Classification,
  answerContext: AnswerContextEntry[],
): ResolvedAnswer {
  void category; // answerContext is pre-filtered to this category by the caller.

  const mine = answerContext.filter((a) => a.case_id === caseId);
  if (mine.length === 0) {
    const stance: Stance =
      classification === "bad" || classification === "blocker" ? "care" : "dont_care";
    return { stance, source: "severity_default", conflicts: [] };
  }

  const distinct = new Set(mine.map((m) => m.stance));
  if (distinct.size === 1) {
    return { stance: mine[0].stance, source: "answers_agree", conflicts: [] };
  }

  return {
    stance: "care",
    source: "answers_conflict",
    conflicts: mine.map((m) => ({ service: m.service, stance: m.stance })),
  };
}

const SYSTEM_PROMPT = `You are the MaterialityJudge for ToS Guardian. You decide which agreement changes/findings are MATERIAL enough to surface to THIS specific user, given what they care about.

Each item is annotated with:
- its severity classification from the ToS;DR taxonomy: good, neutral, bad, or blocker;
- a ToS;DR weight (higher = more consequential);
- the user's resolved stance for this case: "care" or "dont_care".

Decide materiality per item using this guidance:
- An item the user "care"s about AND that is bad or blocker, or that carries a high weight, is MATERIAL.
- A "blocker" the user cares about is essentially always material.
- Items the user marked "dont_care", or that are benign (good/neutral) and low impact, are NOT material.
- The user's stance dominates: do not surface something they explicitly don't care about, and do not suppress something bad/blocker they do care about.
- CONFLICTING HISTORY: some items note the user's prior answers for this SAME case on OTHER services, which disagree (cared on one, not on another). For those, the shown stance is PROVISIONAL (surface-by-default); decide materiality for THIS service by reasoning over that history and the severity/weight — lean toward surfacing when the prior "care" reflects a comparable service.

Return STRICT JSON ONLY — no prose, no explanation, no markdown code fences. An object with exactly:
  - "hasMaterialFindings": boolean — true if ANY item is material.
  - "items": an array with one object per input item, in the same order, each with exactly:
      - "item_id": the item's id.
      - "material": boolean.
      - "reason": a short (one sentence) justification tied to the user's stance and the severity/weight.`;

/** Build the batched judgment prompt from the annotated items. */
function buildJudgePrompt(
  mode: MaterialityJudgeInput["mode"],
  category: string,
  items: AnnotatedItem[],
): string {
  const modeLine =
    mode === "onboarding"
      ? "Mode: onboarding — these are the findings from an agreement the user is signing up to."
      : "Mode: change — these are genuine changes detected against the version the user previously accepted.";

  const blocks = items.map((it) => {
    const conflicted = it.stanceSource === "answers_conflict";
    const lines = [
      `item ${it.itemId} | change: ${it.change.type} | case ${it.case_id} "${it.title}"`,
      `  severity: ${it.classification} | weight: ${it.weight} | your stance: ${it.stance}${
        conflicted ? " (provisional — conflicting history below)" : ""
      }`,
      `  what changed: ${it.change.summary}`,
    ];
    if (conflicted) {
      const history = it.conflicts.map((c) => `${c.service}=${c.stance}`).join(", ");
      lines.push(
        `  your prior answers for this case on other services: ${history} — decide materiality for THIS service using this history.`,
      );
    }
    return lines.join("\n");
  });

  return [modeLine, `Service category: ${category}`, "", blocks.join("\n\n")].join("\n");
}

interface Verdict {
  hasMaterialFindings: boolean;
  items: { itemId: string; material: boolean; reason: string }[];
}

/** Strip an accidental ```json … ``` (or plain ``` … ```) fence. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : trimmed).trim();
}

/** Parse + validate the batched verdict. Throws loudly on malformed data or an item_id
 *  not among the judged items; requires a verdict for every item (no silent gaps,
 *  never fabricate materiality — CLAUDE.md §7). */
function parseVerdict(raw: string, items: AnnotatedItem[]): Verdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error(`MaterialityJudge: model did not return valid JSON. Got: ${raw.slice(0, 500)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`MaterialityJudge: expected a JSON object, got: ${raw.slice(0, 500)}`);
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.hasMaterialFindings !== "boolean") {
    throw new Error(
      `MaterialityJudge: missing or non-boolean "hasMaterialFindings". Got: ${String(obj.hasMaterialFindings)}`,
    );
  }
  if (!Array.isArray(obj.items)) {
    throw new Error(`MaterialityJudge: "items" must be an array. Got: ${raw.slice(0, 500)}`);
  }

  const expected = new Set(items.map((it) => it.itemId));
  const seen = new Map<string, { itemId: string; material: boolean; reason: string }>();
  for (const entry of obj.items) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`MaterialityJudge: an items entry is not an object: ${JSON.stringify(entry)}`);
    }
    const e = entry as Record<string, unknown>;
    const itemId = typeof e.item_id === "string" ? e.item_id.trim() : "";
    if (!itemId || !expected.has(itemId)) {
      throw new Error(
        `MaterialityJudge: verdict references item_id "${String(e.item_id)}" which is not among the judged items ${JSON.stringify([...expected])}.`,
      );
    }
    if (typeof e.material !== "boolean") {
      throw new Error(`MaterialityJudge: item "${itemId}" has a non-boolean "material".`);
    }
    const reason = typeof e.reason === "string" ? e.reason.trim() : "";
    seen.set(itemId, { itemId, material: e.material, reason });
  }

  for (const it of items) {
    if (!seen.has(it.itemId)) {
      throw new Error(`MaterialityJudge: model omitted a verdict for item "${it.itemId}".`);
    }
  }

  return { hasMaterialFindings: obj.hasMaterialFindings, items: [...seen.values()] };
}