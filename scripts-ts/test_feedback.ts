/**
 * scripts-ts/test_feedback.ts — standalone smoke test for the report-feedback
 * write path (lib/feedback.ts → applyReportFeedback), migration step 3.
 *
 * Runs against REAL Supabase (.env.local) with a THROWAWAY report (ZZZ_-prefixed
 * service) and its answer-log rows, then CLEANS UP everything it created so the
 * tables are left pristine. Makes NO LLM call.
 *
 * As of step 3, feedback writes to the `answers` table (setAnswer), and completion
 * is derived from the report's answer rows. This test also asserts the feedback
 * path writes NO `preferences` rows anymore.
 *
 *   (1) PARTIAL feedback (CASE_A only) → answered=false, report 'pending',
 *       CASE_A answer row set (care), CASE_B still unanswered.
 *   (2) REMAINING (CASE_B) → answered=true, report 'answered'.
 *   (3) getReportStances returns the right { case_id -> stance } map.
 *   (4) NO preferences rows were written by the feedback path.
 *   (5) cleanup → delete the throwaway report + answers.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_feedback.ts
 */

import { applyReportFeedback } from "@/lib/feedback";
import {
  insertReport,
  upsertAnswerRows,
  getReportById,
  getReportAnswerRows,
  getReportStances,
  supabase,
} from "@/lib/db";
import type { ReportPoint } from "@/lib/contracts";
import type { NewAnswerRow } from "@/lib/db";

const TEST_SERVICE = "ZZZ_FeedbackSvc";
const TEST_CATEGORY = "ZZZ_FeedbackCategory"; // not a real seeded category
const CASE_A = "ZZZ_FBCASE_A"; // not real ToS;DR case_ids
const CASE_B = "ZZZ_FBCASE_B";

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(`Assertion failed: ${label}`);
  console.log(`  ✓ ${label}`);
}

/** A minimal but shape-valid ReportPoint for the throwaway report. */
function point(caseId: string, title: string): ReportPoint {
  return {
    case_id: caseId,
    case_title: title,
    classification: "bad",
    weight: 50,
    what_it_is: `Throwaway description for ${caseId}.`,
    why_it_matters: `Throwaway reason for ${caseId}.`,
    change: {
      type: "added",
      case_id: caseId,
      before: null,
      after: { clause_id: `cl_${caseId}`, clause_text: "throwaway clause", cases: [] },
      summary: `throwaway change ${caseId}`,
    },
  };
}

function answerRow(reportId: string, caseId: string, title: string): NewAnswerRow {
  return {
    service: TEST_SERVICE,
    category: TEST_CATEGORY,
    case_id: caseId,
    clause: title,
    explanation: `Why ${caseId} matters`,
    agreement_version: 0,
    report_id: reportId,
  };
}

async function cleanup() {
  await supabase.from("answers").delete().eq("service", TEST_SERVICE);
  await supabase.from("reports").delete().eq("service", TEST_SERVICE);
  // Defensive: the feedback path must not write these, but pre-clean regardless.
  await supabase
    .from("preferences")
    .delete()
    .eq("category", TEST_CATEGORY)
    .in("case_id", [CASE_A, CASE_B]);
}

async function main() {
  // Pre-clean in case a prior aborted run left rows behind.
  await cleanup();

  try {
    // Seed the throwaway report AND its answer rows (answered=false), mirroring
    // what /api/execute does at report time.
    console.log("\n--- seed report + answer rows ---");
    const reportId = await insertReport({
      service: TEST_SERVICE,
      category: TEST_CATEGORY,
      points: [point(CASE_A, "Throwaway Case A"), point(CASE_B, "Throwaway Case B")],
      truncation_notice: null,
      response_line: "throwaway",
      source: "manual",
    });
    await upsertAnswerRows([
      answerRow(reportId, CASE_A, "Throwaway Case A"),
      answerRow(reportId, CASE_B, "Throwaway Case B"),
    ]);
    console.log("report id:", reportId);

    const seeded = await getReportAnswerRows(reportId);
    assert(seeded.length === 2, "2 answer rows seeded");
    assert(seeded.every((r) => r.answered === false && r.stance === null), "seeded rows unanswered");

    // (1) PARTIAL: answer only CASE_A.
    console.log("\n--- (1) partial feedback (CASE_A only) ---");
    const r1 = await applyReportFeedback(reportId, { [CASE_A]: "care" });
    console.log("result:", JSON.stringify(r1));
    assert(r1.answered === false, "partial → answered=false");

    const rep1 = await getReportById(reportId);
    assert(rep1?.status === "pending", "report still 'pending' after partial feedback");

    let rows = await getReportAnswerRows(reportId);
    let a = rows.find((r) => r.case_id === CASE_A)!;
    let b = rows.find((r) => r.case_id === CASE_B)!;
    assert(a.answered === true && a.stance === "care", "CASE_A answer row: answered=true stance='care'");
    assert(b.answered === false && b.stance === null, "CASE_B answer row: still unanswered");

    // (2) REMAINING: answer CASE_B → now every row is answered.
    console.log("\n--- (2) remaining feedback (CASE_B) ---");
    const r2 = await applyReportFeedback(reportId, { [CASE_B]: "dont_care" });
    console.log("result:", JSON.stringify(r2));
    assert(r2.answered === true, "remaining → answered=true");

    const rep2 = await getReportById(reportId);
    assert(rep2?.status === "answered", "report now 'answered'");

    rows = await getReportAnswerRows(reportId);
    b = rows.find((r) => r.case_id === CASE_B)!;
    assert(b.answered === true && b.stance === "dont_care", "CASE_B answer row: answered=true stance='dont_care'");

    // (3) getReportStances map.
    console.log("\n--- (3) getReportStances ---");
    const stances = await getReportStances(reportId);
    console.log("stances:", JSON.stringify(stances));
    assert(stances[CASE_A] === "care" && stances[CASE_B] === "dont_care", "stance map matches answers");
    assert(Object.keys(stances).length === 2, "exactly the two answered cases");

    // (4) NO preferences rows written by the feedback path.
    console.log("\n--- (4) no preferences written ---");
    const { count: prefCount } = await supabase
      .from("preferences")
      .select("id", { count: "exact", head: true })
      .eq("category", TEST_CATEGORY)
      .in("case_id", [CASE_A, CASE_B]);
    console.log(`preferences rows for test keys: ${prefCount}`);
    assert(prefCount === 0, "feedback path wrote NO preferences rows");

    console.log("\n✅ all feedback assertions passed");
  } finally {
    // (5) cleanup — always, even if an assertion failed.
    await cleanup();
    const { count: repLeft } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("service", TEST_SERVICE);
    const { count: ansLeft } = await supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("service", TEST_SERVICE);
    console.log(
      `\n--- (5) cleanup done — leftover reports: ${repLeft}, answers: ${ansLeft} (expected 0, 0) ---`,
    );
  }
}

main().catch((err) => {
  console.error("\n!!! test_feedback failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});