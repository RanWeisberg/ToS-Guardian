/**
 * lib/feedback.ts — the report-feedback write path (migration step 3).
 *
 * `applyReportFeedback` records a user's per-point care/don't-care answers for one
 * report into the ANSWER LOG (`answers` table), and flips the report to 'answered'
 * once every finding in it has been answered. Pure core — no HTTP concerns; the
 * route (/api/feedback) wraps it.
 *
 * As of step 3 this writes ONLY to `answers` (setAnswer per finding). It no longer
 * touches the `preferences` table. Completion is derived from the report's answer
 * rows (every row answered=true), which subsumes the old preference-based check.
 * No LLM is involved.
 */

import {
  getReportById,
  setAnswer,
  getReportAnswerRows,
  setReportStatus,
} from "@/lib/db";

/** A per-point feedback stance. */
export type FeedbackStance = "care" | "dont_care";

/**
 * Apply per-point feedback to a report.
 *
 * @param reportId  the persisted report to answer.
 * @param stances   case_id → stance for the findings the user just answered.
 * @returns whether the report is now fully answered.
 */
export async function applyReportFeedback(
  reportId: string,
  stances: Record<string, FeedbackStance>,
): Promise<{ answered: boolean }> {
  // Fetch the report as the existence guard; fail clearly if it's missing.
  // (The answer rows are keyed by (report_id, case_id), so category isn't needed
  // for the write — it was set at report time.)
  const report = await getReportById(reportId);
  if (!report) {
    throw new Error(`applyReportFeedback: report "${reportId}" not found.`);
  }

  // Record each just-submitted answer on its answer-log row (stance + answered).
  for (const [caseId, stance] of Object.entries(stances)) {
    await setAnswer(reportId, caseId, stance);
  }

  // Fully answered ⇔ every one of the report's answer rows is answered.
  const rows = await getReportAnswerRows(reportId);
  const fullyAnswered = rows.length > 0 && rows.every((r) => r.answered);

  if (fullyAnswered) {
    await setReportStatus(reportId, "answered");
  }
  return { answered: fullyAnswered };
}