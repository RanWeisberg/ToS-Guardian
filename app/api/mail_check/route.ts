/**
 * app/api/mail_check/route.ts — the monitoring-path trigger (PROJECT_SPEC §3).
 *
 * BUTTON-ONLY (no cron): mail-checking runs on demand from the header "Check mail"
 * button, which POSTs here. There is no scheduled check — vercel.json carries no
 * crons entry.
 *   POST — the manual "check mail now" trigger (the header button).
 *   GET  — same behaviour, kept as a convenience for manual/curl checks (NOT a
 *          cron target anymore).
 *
 * Both call runMailCheck with the source chosen by selectMailSource() — the real
 * Gmail source when GMAIL_REFRESH_TOKEN is configured, else the mock — and return
 * the { status, error, checked, processed, results } summary (results now include
 * per-email reportId + material). This route is a thin adapter: all driving logic
 * lives in lib/mail/trigger.ts, and the actual pipeline lives in runAgent. The mail
 * layer is infrastructure — it is NOT part of the LLM `steps` trace (CLAUDE.md §7).
 *
 * Node runtime (runAgent pulls in Supabase / Pinecone / OpenAI). Both concrete
 * sources implement the same MailSource interface, so the trigger is unchanged.
 */

import { runMailCheck } from "@/lib/mail/trigger";
import { selectMailSource } from "@/lib/mail/selectSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A single check can drive several runAgent calls (up to MAX_PER_CHECK), each a
// multi-LLM pipeline — give it the 5-min ceiling (Fluid-compute Hobby max) so it
// isn't killed by Vercel's low default timeout.
export const maxDuration = 300;

async function handle(): Promise<Response> {
  try {
    const summary = await runMailCheck(selectMailSource());
    return Response.json({ status: "ok", error: null, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { status: "error", error: message, checked: 0, processed: 0, results: [] },
      { status: 500 },
    );
  }
}

/** The header "Check mail" button POSTs here. */
export async function POST(): Promise<Response> {
  return handle();
}

/** Convenience manual GET (identical behaviour) — handy for a curl check. Not a
 *  cron target: mail-checking is button-only now (no crons in vercel.json). */
export async function GET(): Promise<Response> {
  return handle();
}
