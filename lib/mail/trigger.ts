/**
 * lib/mail/trigger.ts — the Phase 6a mail-trigger adapter.
 *
 * This is the monitoring intake path (PROJECT_SPEC §3): a change-notification
 * email arrives, and a thin trigger drives the SAME core the API uses. It does
 * NOT duplicate any pipeline logic — it frames each email as a prompt and calls
 * runAgent(prompt) from lib/orchestrator.ts. Persisting versions/classifications
 * already happens inside runAgent/StateWriter; this layer only drives it, records
 * the outcome, and marks the email processed.
 *
 * The mail layer is INFRASTRUCTURE (CLAUDE.md §7): it records NOTHING in the LLM
 * `steps` trace. The trace lives inside runAgent's return value, which the mail
 * layer deliberately discards (the monitoring path surfaces reports elsewhere,
 * not the raw trace).
 *
 * Budget guards (CLAUDE.md §5): at most MAX_PER_CHECK notices are processed per
 * check, and an empty inbox short-circuits with ZERO LLM calls. An email is
 * marked processed ONLY after runAgent succeeds, so a failure is retried on the
 * next check rather than silently dropped — and a success is never reprocessed
 * (idempotent dedup, keyed on the email id).
 *
 * Node runtime only (pulls in Supabase / Pinecone / OpenAI via runAgent).
 */

import { runAgent } from "@/lib/orchestrator";
import type { ChangeNoticeEmail, MailSource } from "@/lib/mail/source";

/** Hard cap on how many notices one check will process (runaway-cost guard). */
const MAX_PER_CHECK = 5;

/** Per-email outcome, for the caller's summary (not the LLM trace). */
export interface MailCheckResult {
  id: string;
  status: "processed" | "error";
  note: string;
}

export interface MailCheckSummary {
  /** How many new notices were seen this check (before the cap). */
  checked: number;
  /** How many were actually driven through runAgent and marked processed. */
  processed: number;
  results: MailCheckResult[];
}

/**
 * Frame a change-notice email as a prompt for the core. IntakeRouter reads this
 * and should classify it as a "change_notice" (PROJECT_SPEC §4); the service
 * hint and body give DocumentResolver/ClauseExtractor something to work with.
 */
function buildPrompt(email: ChangeNoticeEmail): string {
  const service = email.service_hint
    ? `Service: ${email.service_hint}`
    : "Service: (not stated — infer from the content)";
  return [
    "The following is a terms-of-service / privacy-policy change-notification email.",
    "Treat it as a change notice for an agreement I previously accepted.",
    "",
    service,
    `Subject: ${email.subject}`,
    "",
    email.body,
  ].join("\n");
}

/** Short, single-line note derived from the agent's response (for the summary). */
function summarize(response: string): string {
  const oneLine = response.replace(/\s+/g, " ").trim();
  return oneLine.length > 200 ? oneLine.slice(0, 200) + "…" : oneLine;
}

/**
 * Poll the given source for new change notices and drive each through the core.
 * Source-agnostic: works with the mock (Phase 6a) and Gmail (Phase 6b) alike.
 */
export async function runMailCheck(source: MailSource): Promise<MailCheckSummary> {
  const notices = await source.fetchNewChangeNotices();

  // Empty inbox → short-circuit with zero LLM calls (budget, CLAUDE.md §5).
  if (notices.length === 0) {
    return { checked: 0, processed: 0, results: [] };
  }

  const batch = notices.slice(0, MAX_PER_CHECK);
  const results: MailCheckResult[] = [];
  let processed = 0;

  // Sequential on purpose: bounds concurrent LLM spend and keeps us well under
  // the 5-minute ceiling with a small, capped batch (CLAUDE.md §2/§5).
  for (const email of batch) {
    try {
      const { response } = await runAgent(buildPrompt(email));
      // Mark processed ONLY after a successful run → idempotent; failures retry.
      await source.markProcessed(email.id);
      processed += 1;
      results.push({ id: email.id, status: "processed", note: summarize(response) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: email.id, status: "error", note: message });
    }
  }

  return { checked: notices.length, processed, results };
}
