/**
 * scripts-ts/test_answers.ts — standalone smoke test for the answer-log data
 * layer (lib/db.ts: upsertAnswerRows / setAnswer / getReportAnswerRows).
 *
 * Runs against REAL Supabase (.env.local) with a THROWAWAY service "ZZZ_AnsSvc"
 * and a throwaway report_id, then CLEANS UP everything it created so the table is
 * left pristine. Makes NO LLM call.
 *
 *   (1) upsertAnswerRows (2 findings)          → 2 rows, answered=false, stance null.
 *   (2) upsertAnswerRows again, version bumped  → STILL 2 rows, version bumped,
 *                                                 stance/answered preserved.
 *   (3) setAnswer(caseA, 'care')                → caseA answered, caseB not.
 *   (4) fully-answered = every row answered      → false, then answer caseB → true.
 *   (5) cleanup                                  → 0 rows left.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_answers.ts
 */

import {
  upsertAnswerRows,
  setAnswer,
  getReportAnswerRows,
  supabase,
} from "@/lib/db";
import type { NewAnswerRow } from "@/lib/db";

const TEST_SERVICE = "ZZZ_AnsSvc";
const TEST_CATEGORY = "ZZZ_AnsCategory"; // not a real seeded category
const TEST_REPORT_ID = "ZZZ_ANS_REPORT"; // not a real reports.id
const CASE_A = "ZZZ_ANSCASE_A"; // not real ToS;DR case_ids
const CASE_B = "ZZZ_ANSCASE_B";

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(`Assertion failed: ${label}`);
  console.log(`  ✓ ${label}`);
}

function rows(agreementVersion: number): NewAnswerRow[] {
  return [
    {
      service: TEST_SERVICE,
      category: TEST_CATEGORY,
      case_id: CASE_A,
      clause: `Clause A (v${agreementVersion})`,
      explanation: `Why A matters (v${agreementVersion})`,
      agreement_version: agreementVersion,
      report_id: TEST_REPORT_ID,
    },
    {
      service: TEST_SERVICE,
      category: TEST_CATEGORY,
      case_id: CASE_B,
      clause: `Clause B (v${agreementVersion})`,
      explanation: `Why B matters (v${agreementVersion})`,
      agreement_version: agreementVersion,
      report_id: TEST_REPORT_ID,
    },
  ];
}

async function cleanup() {
  await supabase.from("answers").delete().eq("service", TEST_SERVICE);
}

/** A report is fully answered only when EVERY one of its rows is answered. */
function fullyAnswered(answerRows: { answered: boolean }[]): boolean {
  return answerRows.length > 0 && answerRows.every((r) => r.answered);
}

async function main() {
  // Pre-clean in case a prior aborted run left rows behind.
  await cleanup();

  try {
    // (1) initial upsert (2 findings, v0).
    console.log("\n--- (1) initial upsert (2 findings, v0) ---");
    await upsertAnswerRows(rows(0));
    let all = await getReportAnswerRows(TEST_REPORT_ID);
    console.log(`rows: ${all.length}`);
    assert(all.length === 2, "2 answer rows created");
    assert(all.every((r) => r.answered === false), "both rows answered=false");
    assert(all.every((r) => r.stance === null), "both rows stance=null");
    assert(all.every((r) => r.agreement_version === 0), "both rows agreement_version=0");

    // (3-prep) answer CASE_A BEFORE the re-review, to prove (2) preserves it.
    console.log("\n--- (3) setAnswer(CASE_A, 'care') ---");
    await setAnswer(TEST_REPORT_ID, CASE_A, "care");
    all = await getReportAnswerRows(TEST_REPORT_ID);
    let a = all.find((r) => r.case_id === CASE_A)!;
    let b = all.find((r) => r.case_id === CASE_B)!;
    assert(a.answered === true && a.stance === "care", "CASE_A answered=true stance='care'");
    assert(b.answered === false && b.stance === null, "CASE_B still unanswered");

    // (2) re-review: same service+cases, version bumped → updated in place,
    //     STILL 2 rows, version bumped, prior answer PRESERVED.
    console.log("\n--- (2) re-review upsert (v1) → updates in place, preserves answers ---");
    await upsertAnswerRows(rows(1));
    all = await getReportAnswerRows(TEST_REPORT_ID);
    console.log(`rows: ${all.length}`);
    assert(all.length === 2, "STILL 2 rows (updated in place, no duplicates)");
    assert(all.every((r) => r.agreement_version === 1), "agreement_version bumped to 1");
    a = all.find((r) => r.case_id === CASE_A)!;
    b = all.find((r) => r.case_id === CASE_B)!;
    assert(a.answered === true && a.stance === "care", "CASE_A answer PRESERVED across re-review");
    assert(b.answered === false && b.stance === null, "CASE_B still unanswered after re-review");
    assert(a.clause === "Clause A (v1)", "CASE_A provenance (clause) refreshed to v1");

    // (4) fully-answered check.
    console.log("\n--- (4) fully-answered check ---");
    assert(fullyAnswered(all) === false, "not fully answered (CASE_B open)");
    await setAnswer(TEST_REPORT_ID, CASE_B, "dont_care");
    all = await getReportAnswerRows(TEST_REPORT_ID);
    b = all.find((r) => r.case_id === CASE_B)!;
    assert(b.answered === true && b.stance === "dont_care", "CASE_B answered=true stance='dont_care'");
    assert(fullyAnswered(all) === true, "now fully answered (both rows answered)");

    console.log("\n✅ all answer-log assertions passed");
  } finally {
    // (5) cleanup — always, even if an assertion failed.
    await cleanup();
    const { count } = await supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("service", TEST_SERVICE);
    console.log(`\n--- (5) cleanup done — leftover ${TEST_SERVICE} rows: ${count} (expected 0) ---`);
  }
}

main().catch((err) => {
  console.error("\n!!! test_answers failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});