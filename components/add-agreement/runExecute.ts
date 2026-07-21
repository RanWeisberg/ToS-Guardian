/**
 * components/add-agreement/runExecute.ts — a tiny client-side caller for the
 * existing POST /api/execute endpoint. Front-end only: it builds no state and
 * touches no backend module; it sends { prompt } and returns the parsed
 * ExecuteResponse envelope (CLAUDE.md §4) plus the persisted report id.
 *
 * The JSON envelope's four keys are unchanged; the new report's id (when a run
 * produced one) rides on the `X-Report-Id` response HEADER. The route returns
 * the ExecuteResponse shape for BOTH success and handled errors, so we parse the
 * body either way and only synthesize an error envelope when the body isn't the
 * expected JSON. A thrown fetch (network failure) propagates to the caller.
 */

import type { ExecuteResponse } from "@/lib/contracts";

export interface RunExecuteResult {
  data: ExecuteResponse;
  /** The persisted report id from the X-Report-Id header; null when silent. */
  reportId: string | null;
}

export async function runExecute(prompt: string): Promise<RunExecuteResult> {
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const reportId = res.headers.get("X-Report-Id");

  try {
    const data = (await res.json()) as ExecuteResponse;
    return { data, reportId: reportId ?? null };
  } catch {
    return {
      data: {
        status: "error",
        error: `The server returned an unexpected response (HTTP ${res.status}).`,
        response: null,
        steps: [],
      },
      reportId: null,
    };
  }
}
