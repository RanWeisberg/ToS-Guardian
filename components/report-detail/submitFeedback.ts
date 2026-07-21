/**
 * components/report-detail/submitFeedback.ts — a tiny client-side caller for the
 * POST /api/feedback route. Front-end only: it sends { reportId, stances } and
 * returns the parsed { ok, answered?, error? } result. It only synthesizes an
 * error result when the body isn't the expected JSON; a thrown fetch (network
 * failure) propagates to the caller.
 */

import type { FeedbackStance } from "./ReportDetail";

export interface SubmitFeedbackResult {
  ok: boolean;
  answered?: boolean;
  error?: string;
}

export async function submitFeedback(
  reportId: string,
  stances: Record<string, FeedbackStance>,
): Promise<SubmitFeedbackResult> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, stances }),
  });

  try {
    return (await res.json()) as SubmitFeedbackResult;
  } catch {
    return {
      ok: false,
      error: `The server returned an unexpected response (HTTP ${res.status}).`,
    };
  }
}