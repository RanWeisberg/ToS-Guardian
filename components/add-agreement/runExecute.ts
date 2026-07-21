/**
 * components/add-agreement/runExecute.ts — a tiny client-side caller for the
 * existing POST /api/execute endpoint. Front-end only: it builds no state and
 * touches no backend module; it just sends { prompt } and returns the parsed
 * ExecuteResponse envelope (CLAUDE.md §4).
 *
 * The route returns the ExecuteResponse shape for BOTH success and handled
 * errors (with an appropriate HTTP status), so we parse the body either way and
 * only synthesize an error envelope when the body isn't the expected JSON.
 * A thrown fetch (network failure) propagates to the caller to handle.
 */

import type { ExecuteResponse } from "@/lib/contracts";

export async function runExecute(prompt: string): Promise<ExecuteResponse> {
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  try {
    return (await res.json()) as ExecuteResponse;
  } catch {
    return {
      status: "error",
      error: `The server returned an unexpected response (HTTP ${res.status}).`,
      response: null,
      steps: [],
    };
  }
}