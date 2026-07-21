/**
 * lib/feedback.ts — the report-feedback write path (Phase 7 Step D core).
 *
 * `applyReportFeedback` records a user's per-point care/don't-care answers for one
 * report as user preferences, and flips the report to 'answered' once EVERY point
 * in it has been answered (by this submission or a prior one). Pure core — no HTTP
 * concerns; the route wraps it in the next chunk.
 *
 * The category is always derived from the persisted report row, never trusted from
 * the client. Preference writes go exclusively through db.upsertPreferences (the
 * single source of truth), and no LLM is involved.
 */

import type { PreferenceUpdate } from "@/lib/contracts";
import type { Preference } from "@/lib/db";
import {
  getReportById,
  upsertPreferences,
  setReportStatus,
  getUserPreferenceCaseIds,
} from "@/lib/db";

/** A per-point feedback stance — the exact union the preference store writes. */
export type FeedbackStance = Preference["stance"]; // "care" | "dont_care"

/**
 * Apply per-point feedback to a report.
 *
 * @param reportId  the persisted report to answer.
 * @param stances   case_id → stance for the points the user just answered.
 * @returns whether the report is now fully answered.
 */
export async function applyReportFeedback(
  reportId: string,
  stances: Record<string, FeedbackStance>,
): Promise<{ answered: boolean }> {
  // a. Fetch the report; fail clearly if it doesn't exist.
  const report = await getReportById(reportId);
  if (!report) {
    throw new Error(`applyReportFeedback: report "${reportId}" not found.`);
  }

  // b. Category comes from the row — never trust the client for it.
  const category = report.category;

  // c. Persist the just-submitted answers as user preferences.
  const submittedCaseIds = Object.keys(stances);
  const updates: PreferenceUpdate[] = submittedCaseIds.map((case_id) => ({
    case_id,
    category,
    stance: stances[case_id],
  }));
  await upsertPreferences(updates);

  // d. Fully answered? The union of the just-submitted case_ids AND those that
  //    already carry a source='user' preference at this (case_id, category) must
  //    cover every point in the report.
  const pointCaseIds = report.points.map((p) => p.case_id);
  const answered = new Set<string>(submittedCaseIds);
  for (const id of await getUserPreferenceCaseIds(pointCaseIds, category)) {
    answered.add(id);
  }
  const fullyAnswered = pointCaseIds.every((id) => answered.has(id));

  // e. Flip to 'answered' only when complete; otherwise leave it 'pending'.
  if (fullyAnswered) {
    await setReportStatus(reportId, "answered");
  }
  return { answered: fullyAnswered };
}