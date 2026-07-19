/**
 * lib/modules/materialityJudge.ts — Module 6 of the eight-module core (PROJECT_SPEC §4 row 6).
 *
 * MaterialityJudge weighs the changes/findings against the user's preference slice and the
 * ToS;DR case weights to decide what is worth surfacing (empty ⇒ ReportComposer stays
 * silent).
 *
 * DESIGN NOTE (flagged + confirmed): the task's STEP A described fetching the preference
 * slice from Supabase inside this module, but the frozen contract carries
 * `MaterialityJudgeInput.preferenceSlice` as an INPUT. Per the "honor the contract"
 * decision, this module stays PURE (input → output, no store I/O, like the other five
 * modules): it resolves each case's stance MECHANICALLY from the provided slice via the
 * §5 fallback hierarchy (exact (case_id, category) → general (case_id, '*') → ToS;DR
 * severity default). The Supabase fetch that produces the slice lives in the orchestrator.
 *
 * Step A (stance resolution) is mechanical — no LLM. Step B is exactly ONE LLM judgment
 * call. The preference resolution is NOT a trace Step.
 */

import type {
  MaterialityJudgeInput,
  MaterialityJudgeOutput,
  MaterialFinding,
  MatchedCase,
  DiffChange,
  Classification,
} from "@/lib/contracts";
import type { Preference } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import { chat } from "@/lib/llmod";
import type { Tracer } from "@/lib/trace";

/** The general (non-category-specific) preference key. */
const GENERAL_CATEGORY = "*";

type Stance = Preference["stance"]; // "care" | "dont_care"

/** One change annotated with the metadata the judgment call reasons over. */
interface AnnotatedItem {
  itemId: string; // stable id "i0", "i1", … for round-tripping through the LLM
  change: DiffChange;
  case_id: string;
  classification: Classification;
  weight: number;
  title: string;
  stance: Stance;
  stanceSource: "exact" | "general" | "severity_default";
}

export async function runMaterialityJudge(
  input: MaterialityJudgeInput,
  tracer: Tracer,
): Promise<MaterialityJudgeOutput> {
  const { mode, category, changes, preferenceSlice } = input;

  // --- STEP A (mechanical): annotate each judgeable change with severity + resolved
  //     stance. "unchanged" carry-overs are not changes to report, and changes without a
  //     resolvable case can't be weighed — both are dropped here (no LLM cost). ---
  const items: AnnotatedItem[] = [];
  changes.forEach((change, i) => {
    if (change.type === "unchanged") return;
    const matched = matchedCaseFor(change);
    if (!matched || !change.case_id) return;
    const { stance, source } = resolveStance(
      change.case_id,
      category,
      matched.classification,
      preferenceSlice,
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

/** §5 fallback hierarchy: exact (case_id, category) → general (case_id, '*') →
 *  ToS;DR severity default (care iff bad/blocker). Purely mechanical over the slice. */
function resolveStance(
  caseId: string,
  category: string,
  classification: Classification,
  slice: Preference[],
): { stance: Stance; source: AnnotatedItem["stanceSource"] } {
  const exact = slice.find((p) => p.case_id === caseId && p.category === category);
  if (exact) return { stance: exact.stance, source: "exact" };

  const general = slice.find((p) => p.case_id === caseId && p.category === GENERAL_CATEGORY);
  if (general) return { stance: general.stance, source: "general" };

  const severityStance: Stance =
    classification === "bad" || classification === "blocker" ? "care" : "dont_care";
  return { stance: severityStance, source: "severity_default" };
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

  const blocks = items.map((it) =>
    [
      `item ${it.itemId} | change: ${it.change.type} | case ${it.case_id} "${it.title}"`,
      `  severity: ${it.classification} | weight: ${it.weight} | your stance: ${it.stance}`,
      `  what changed: ${it.change.summary}`,
    ].join("\n"),
  );

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