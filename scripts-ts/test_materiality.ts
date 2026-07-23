/**
 * scripts-ts/test_materiality.ts — standalone smoke test for Module 6 (MaterialityJudge).
 *
 * MaterialityJudge honors the frozen contract: it takes the ANSWER CONTEXT as INPUT
 * (the answered stances for the involved cases, across services, already filtered to
 * the category — the orchestrator's job) and does no store I/O. This test plays the
 * orchestrator's role by building that context in-code, so it needs no Supabase.
 *
 * Two scenarios (each makes exactly ONE MaterialityJudge LLM call):
 *   (1) a bad / high-weight case the user has answered "care" (on another service)
 *       → answers_agree → expect hasMaterialFindings true and that item material.
 *   (2) a benign case with NO answers → severity default "dont_care"
 *       → expect hasMaterialFindings false.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_materiality.ts
 */

import { runMaterialityJudge } from "@/lib/modules/materialityJudge";
import { Tracer } from "@/lib/trace";
import type { DiffChange, MatchedCase, MaterialityMode } from "@/lib/contracts";

const CATEGORY = "cloud storage";

/** The minimal answer-context shape MaterialityJudgeInput carries. */
type AnswerContext = { service: string; case_id: string; stance: "care" | "dont_care" }[];

// Real ToS;DR cases (ids/severity/weight as seen from the CaseClassifier taxonomy).
const BAD_HIGH = mc("166", "This service shares your personal data with third parties that are not essential to its operation", "bad", 70);
const BENIGN = mc("123", "When the service wants to change its terms, you are notified a week or more in advance", "good", 15);

function mc(case_id: string, title: string, classification: MatchedCase["classification"], weight: number): MatchedCase {
  return { case_id, title, classification, weight, topic: "Test Topic", confidence: 0.95 };
}

/** An "added" change carrying one matched case (the monitoring path shape). */
function addedChange(matched: MatchedCase, summary: string): DiffChange {
  return {
    type: "added",
    case_id: matched.case_id,
    before: null,
    after: { clause_id: "c1", clause_text: `[clause expressing ${matched.title}]`, cases: [matched] },
    summary,
  };
}

async function runScenario(
  label: string,
  mode: MaterialityMode,
  changes: DiffChange[],
  answerContext: AnswerContext,
) {
  console.log("\n=====================================================");
  console.log(`SCENARIO: ${label}`);
  console.log("=====================================================");
  console.log("answer context passed:", JSON.stringify(answerContext));

  const tracer = new Tracer();
  const out = await runMaterialityJudge({ mode, category: CATEGORY, changes, answerContext }, tracer);

  // Resolved stances are visible in the recorded step's user_prompt.
  if (tracer.steps.length > 0) {
    const stanceLines = tracer.steps[0].prompt.user_prompt
      .split("\n")
      .filter((l) => l.includes("your stance:"))
      .map((l) => l.trim());
    console.log("resolved stances used:", JSON.stringify(stanceLines));
    console.log("judge verdict:", JSON.stringify(tracer.steps[0].response));
  }

  console.log(`material findings (${out.material.length}):`);
  for (const f of out.material) {
    console.log(`  - case ${f.case_id} [${f.classification}, w${f.weight}] — ${f.reason}`);
  }
  console.log(`steps recorded: ${tracer.steps.length} (expected 1)`);
}

async function main() {
  await runScenario(
    "(1) bad/high case the user answered 'care' (another service) → expect material",
    "change",
    [addedChange(BAD_HIGH, "New case: the service now shares your personal data with non-essential third parties.")],
    [{ service: "Some Other Service", case_id: BAD_HIGH.case_id, stance: "care" }],
  );

  await runScenario(
    "(2) benign case, no answers → severity default dont_care → expect NOT material",
    "change",
    [addedChange(BENIGN, "The service now gives a week's notice before changing its terms.")],
    [],
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
