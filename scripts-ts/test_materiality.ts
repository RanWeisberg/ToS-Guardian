/**
 * scripts-ts/test_materiality.ts — standalone smoke test for Module 6 (MaterialityJudge).
 *
 * Because MaterialityJudge honors the frozen contract (it takes the preference slice as
 * INPUT and does no store I/O), this test plays the orchestrator's role: it fetches the
 * RELEVANT preference slice from the REAL seeded Supabase table (case_ids × category and
 * the general '*' default) and passes it in.
 *
 * Two scenarios:
 *   (1) a change on a bad / high-weight case the user cares about by default
 *       → expect hasMaterialFindings true and that item material.
 *   (2) a change on a benign case the user doesn't care about
 *       → expect hasMaterialFindings false.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_materiality.ts
 */

import { runMaterialityJudge } from "@/lib/modules/materialityJudge";
import { Tracer } from "@/lib/trace";
import { supabase } from "@/lib/db";
import type { Preference } from "@/lib/db";
import type { DiffChange, MatchedCase, MaterialityMode } from "@/lib/contracts";

const CATEGORY = "cloud storage";

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

/** Fetch the relevant preference slice from Supabase (orchestrator's job). */
async function fetchSlice(caseIds: string[]): Promise<Preference[]> {
  const { data, error } = await supabase
    .from("preferences")
    .select("*")
    .in("case_id", caseIds)
    .in("category", [CATEGORY, "*"]);
  if (error) throw new Error(`Supabase preferences query failed: ${error.message}`);
  return (data ?? []) as Preference[];
}

async function runScenario(
  label: string,
  mode: MaterialityMode,
  changes: DiffChange[],
  slice: Preference[],
) {
  console.log("\n=====================================================");
  console.log(`SCENARIO: ${label}`);
  console.log("=====================================================");
  console.log("preference slice fetched:", JSON.stringify(slice));

  const tracer = new Tracer();
  const out = await runMaterialityJudge({ mode, category: CATEGORY, changes, preferenceSlice: slice }, tracer);

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
  const slice = await fetchSlice([BAD_HIGH.case_id, BENIGN.case_id]);

  await runScenario(
    "(1) bad/high-weight case the user cares about → expect material",
    "change",
    [addedChange(BAD_HIGH, "New case: the service now shares your personal data with non-essential third parties.")],
    slice.filter((p) => p.case_id === BAD_HIGH.case_id),
  );

  await runScenario(
    "(2) benign case → expect NOT material",
    "change",
    [addedChange(BENIGN, "The service now gives a week's notice before changing its terms.")],
    slice.filter((p) => p.case_id === BENIGN.case_id),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
