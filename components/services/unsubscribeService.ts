/**
 * components/services/unsubscribeService.ts — a tiny client-side caller for the
 * POST /api/unsubscribe route. Front-end only: it sends { service } and returns
 * the parsed { ok, error? } result. It only synthesizes an error result when the
 * body isn't the expected JSON; a thrown fetch (network failure) propagates.
 */

export interface UnsubscribeResult {
  ok: boolean;
  error?: string;
}

export async function unsubscribeService(service: string): Promise<UnsubscribeResult> {
  const res = await fetch("/api/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service }),
  });

  try {
    return (await res.json()) as UnsubscribeResult;
  } catch {
    return {
      ok: false,
      error: `The server returned an unexpected response (HTTP ${res.status}).`,
    };
  }
}