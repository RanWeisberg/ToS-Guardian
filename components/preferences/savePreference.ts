/**
 * components/preferences/savePreference.ts — a tiny client-side caller for the
 * POST /api/preferences route. Front-end only: it sends { case_id, category,
 * stance } and returns the parsed { ok, error? } result. It only synthesizes an
 * error result when the body isn't the expected JSON; a thrown fetch (network
 * failure) propagates to the caller.
 */

import type { FeedbackStance } from "@/components/report-detail/ReportDetail";

export interface SavePreferenceResult {
  ok: boolean;
  error?: string;
}

export async function savePreference(
  caseId: string,
  category: string,
  stance: FeedbackStance,
): Promise<SavePreferenceResult> {
  const res = await fetch("/api/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_id: caseId, category, stance }),
  });

  try {
    return (await res.json()) as SavePreferenceResult;
  } catch {
    return {
      ok: false,
      error: `The server returned an unexpected response (HTTP ${res.status}).`,
    };
  }
}
