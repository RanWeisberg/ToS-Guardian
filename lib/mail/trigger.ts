/**
 * lib/mail/trigger.ts — the Phase 6a mail-trigger adapter.
 *
 * This is the monitoring intake path (PROJECT_SPEC §3): a change-notification
 * email arrives, and a thin trigger drives the SAME core the API uses. It does
 * NOT duplicate any pipeline logic — it frames each email as a prompt and calls
 * runAgent(prompt) from lib/orchestrator.ts. Persisting versions/classifications
 * already happens inside runAgent/StateWriter; on top of that this layer persists
 * the produced report + answer rows EXACTLY like the manual /api/execute path,
 * only tagged source='mail' (so mail-processed emails become visible reports).
 *
 * The mail layer is INFRASTRUCTURE (CLAUDE.md §7): it records NOTHING in the LLM
 * `steps` trace. The trace lives inside runAgent's return value, which the mail
 * layer deliberately discards — it surfaces reports via the report/answer stores,
 * not the raw trace.
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
import { insertReport, upsertAnswerRows } from "@/lib/db";
import type { ChangeNoticeEmail, MailSource } from "@/lib/mail/source";

/** Hard cap on how many notices one check will process (runaway-cost guard). */
const MAX_PER_CHECK = 5;

/** Per-email outcome, for the caller's summary (not the LLM trace). */
export interface MailCheckResult {
  id: string;
  status: "processed" | "error";
  note: string;
  /** The persisted report id when the run produced one; null on a silent run
   *  (nothing material) or on error. */
  reportId: string | null;
  /** True when a report was produced (something material); false for a silent
   *  run or an error. */
  material: boolean;
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
      const { response, report } = await runAgent(buildPrompt(email));

      // Persist EXACTLY like the manual /api/execute path, but tagged source='mail'.
      // A silent run (report === null, nothing material) persists nothing. Done
      // BEFORE markProcessed so a persistence failure retries the email next check.
      let reportId: string | null = null;
      if (report) {
        reportId = await insertReport({ ...report, source: "mail" });
        await upsertAnswerRows(
          report.points.map((p) => ({
            service: report.service,
            category: report.category,
            case_id: p.case_id,
            clause: p.case_title,
            explanation: p.why_it_matters,
            agreement_version: report.version,
            report_id: reportId as string,
          })),
        );
      }

      // Mark processed ONLY after a successful run AND its persistence → idempotent;
      // a failure in either step leaves the email unprocessed for the next check.
      await source.markProcessed(email.id);
      processed += 1;
      results.push({
        id: email.id,
        status: "processed",
        note: summarize(response),
        reportId,
        material: report !== null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        id: email.id,
        status: "error",
        note: message,
        reportId: null,
        material: false,
      });
    }
  }

  return { checked: notices.length, processed, results };
}
