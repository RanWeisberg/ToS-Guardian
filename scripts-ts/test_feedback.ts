/**
 * scripts-ts/test_feedback.ts — standalone smoke test for the report-feedback
 * write path (lib/feedback.ts → applyReportFeedback).
 *
 * Runs against REAL Supabase (.env.local) using a THROWAWAY report (ZZZ_-prefixed
 * service) and throwaway (case_id, category) preference keys so nothing real is
 * touched, then CLEANS UP everything it created so the tables are left pristine.
 * Makes NO LLM call.
 *
 *   (1) PARTIAL feedback (one of two points) → answered=false, report 'pending',
 *       the submitted pref present with source='user'.
 *   (2) REMAINING point → answered=true, report 'answered', that pref present.
 *   (3) cleanup → delete the throwaway report + prefs.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_feedback.ts
 */

import { applyReportFeedback } from "@/lib/feedback";
import { insertReport, getReportById, supabase } from "@/lib/db";
import type { ReportPoint } from "@/lib/contracts";

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

async function readPref(caseId: string) {
  const { data } = await supabase
    .from("preferences")
    .select("case_id, category, stance, source")
    .eq("case_id", caseId)
    .eq("category", TEST_CATEGORY)
    .maybeSingle();
  return data;
}

async function cleanup() {
  await supabase.from("reports").delete().eq("service", TEST_SERVICE);
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
    // Create the throwaway report (two points).
    console.log("\n--- create throwaway report ---");
    const reportId = await insertReport({
      service: TEST_SERVICE,
      category: TEST_CATEGORY,
      points: [point(CASE_A, "Throwaway Case A"), point(CASE_B, "Throwaway Case B")],
      truncation_notice: null,
      response_line: "throwaway",
      source: "manual",
    });
    console.log("report id:", reportId);

    // (1) PARTIAL: answer only CASE_A.
    console.log("\n--- (1) partial feedback (CASE_A only) ---");
    const r1 = await applyReportFeedback(reportId, { [CASE_A]: "care" });
    console.log("result:", JSON.stringify(r1));
    assert(r1.answered === false, "partial → answered=false");

    const rep1 = await getReportById(reportId);
    assert(rep1?.status === "pending", "report still 'pending' after partial feedback");

    const prefA = await readPref(CASE_A);
    console.log("pref A:", JSON.stringify(prefA));
    assert(!!prefA, "CASE_A preference row exists");
    assert(prefA?.source === "user", "CASE_A pref has source='user'");
    assert(prefA?.stance === "care", "CASE_A pref has stance='care'");

    // (2) REMAINING: answer CASE_B → now every point is covered.
    console.log("\n--- (2) remaining feedback (CASE_B) ---");
    const r2 = await applyReportFeedback(reportId, { [CASE_B]: "dont_care" });
    console.log("result:", JSON.stringify(r2));
    assert(r2.answered === true, "remaining → answered=true");

    const rep2 = await getReportById(reportId);
    assert(rep2?.status === "answered", "report now 'answered'");

    const prefB = await readPref(CASE_B);
    console.log("pref B:", JSON.stringify(prefB));
    assert(prefB?.source === "user", "CASE_B pref has source='user'");
    assert(prefB?.stance === "dont_care", "CASE_B pref has stance='dont_care'");

    console.log("\n✅ all feedback assertions passed");
  } finally {
    // (3) cleanup — always, even if an assertion failed.
    await cleanup();
    const { count: repLeft } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("service", TEST_SERVICE);
    const { count: prefLeft } = await supabase
      .from("preferences")
      .select("id", { count: "exact", head: true })
      .eq("category", TEST_CATEGORY)
      .in("case_id", [CASE_A, CASE_B]);
    console.log(
      `\n--- (3) cleanup done — leftover reports: ${repLeft}, prefs: ${prefLeft} (expected 0, 0) ---`,
    );
  }
}

main().catch((err) => {
  console.error("\n!!! test_feedback failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});