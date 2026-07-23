/**
 * scripts-ts/test_answer_resolution.ts — pure unit test for resolveFromAnswers
 * (lib/modules/materialityJudge.ts), the §5 stance-resolution core.
 *
 * NO LLM call, NO Supabase. It imports resolveFromAnswers directly and asserts
 * the taxonomy-base + answers-enrich behavior. (Run with --env-file only because
 * importing the module loads lib/config, which validates env at import; the LLM
 * client stays lazy and is never touched here.)
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_answer_resolution.ts
 */

import { resolveFromAnswers } from "@/lib/modules/materialityJudge";

const CAT = "cloud storage";
type Ctx = { service: string; case_id: string; stance: "care" | "dont_care" }[];

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.log(`  ✗ FAIL ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function main() {
  console.log("\n=== resolveFromAnswers ===");

  // 1. No answers for a bad case → severity default 'care'.
  const r1 = resolveFromAnswers("166", CAT, "bad", []);
  assert(r1.stance === "care" && r1.source === "severity_default", "no answers + bad → care / severity_default");
  assert(r1.conflicts.length === 0, "  (no conflicts)");

  // Also blocker → care (severity default).
  const r1b = resolveFromAnswers("999", CAT, "blocker", []);
  assert(r1b.stance === "care" && r1b.source === "severity_default", "no answers + blocker → care / severity_default");

  // 2. No answers for a good/neutral case → severity default 'dont_care'.
  const r2 = resolveFromAnswers("123", CAT, "good", []);
  assert(r2.stance === "dont_care" && r2.source === "severity_default", "no answers + good → dont_care / severity_default");
  const r2b = resolveFromAnswers("124", CAT, "neutral", []);
  assert(r2b.stance === "dont_care" && r2b.source === "severity_default", "no answers + neutral → dont_care / severity_default");

  // 3. Two services both 'care' → 'care', 'answers_agree'.
  const bothCare: Ctx = [
    { service: "Acme Cloud", case_id: "166", stance: "care" },
    { service: "Globex Drive", case_id: "166", stance: "care" },
  ];
  const r3 = resolveFromAnswers("166", CAT, "bad", bothCare);
  assert(r3.stance === "care" && r3.source === "answers_agree", "both services care → care / answers_agree");
  assert(r3.conflicts.length === 0, "  (agreement carries no conflict history)");

  // 4. Two services both 'dont_care' → 'dont_care', 'answers_agree' (answers
  //    override the severity default: classification is 'bad' yet result is dont_care).
  const bothDont: Ctx = [
    { service: "Acme Cloud", case_id: "166", stance: "dont_care" },
    { service: "Globex Drive", case_id: "166", stance: "dont_care" },
  ];
  const r4 = resolveFromAnswers("166", CAT, "bad", bothDont);
  assert(r4.stance === "dont_care" && r4.source === "answers_agree", "both services dont_care → dont_care / answers_agree (overrides severity)");

  // 5. One 'care' + one 'dont_care' → 'answers_conflict' with conflict history.
  const mixed: Ctx = [
    { service: "Acme Cloud", case_id: "166", stance: "care" },
    { service: "Globex Drive", case_id: "166", stance: "dont_care" },
  ];
  const r5 = resolveFromAnswers("166", CAT, "bad", mixed);
  assert(r5.source === "answers_conflict", "care + dont_care → answers_conflict");
  assert(r5.stance === "care", "  (conflict provisional stance = care, surface-by-default)");
  assert(r5.conflicts.length === 2, "  (conflict history present: both services)");
  assert(
    r5.conflicts.some((c) => c.service === "Acme Cloud" && c.stance === "care") &&
      r5.conflicts.some((c) => c.service === "Globex Drive" && c.stance === "dont_care"),
    "  (conflict history carries each service's stance)",
  );

  // Bonus: entries for OTHER case_ids are ignored (resolution filters by case_id).
  const other: Ctx = [{ service: "Acme Cloud", case_id: "999", stance: "dont_care" }];
  const r6 = resolveFromAnswers("166", CAT, "bad", other);
  assert(r6.source === "severity_default" && r6.stance === "care", "unrelated case_id ignored → severity_default");

  console.log("\n=====================================================");
  if (failures === 0) {
    console.log("✅ all resolveFromAnswers assertions passed");
  } else {
    console.log(`❌ ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main();
