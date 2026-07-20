/**
 * app/api/mail_check/route.ts — the monitoring-path trigger (PROJECT_SPEC §3).
 *
 * Two ways in, one behaviour:
 *   POST — the manual "check mail now" button for the demo (never wait on a
 *          timer in front of an audience).
 *   GET  — the Vercel cron target (see vercel.json). Cron issues a GET.
 *
 * Both call runMailCheck with the source chosen by selectMailSource() — the real
 * Gmail source when GMAIL_REFRESH_TOKEN is configured, else the mock — and return
 * the { checked, processed, results } summary. This route is a thin adapter: all
 * driving logic lives in lib/mail/trigger.ts, and the actual pipeline lives in
 * runAgent. The mail layer is infrastructure — it is NOT part of the LLM `steps`
 * trace (CLAUDE.md §7).
 *
 * Node runtime (runAgent pulls in Supabase / Pinecone / OpenAI). Both concrete
 * sources implement the same MailSource interface, so the trigger is unchanged.
 */

import { runMailCheck } from "@/lib/mail/trigger";
import { selectMailSource } from "@/lib/mail/selectSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** Manual "check mail now" trigger (demo button). */
export async function POST(): Promise<Response> {
  return handle();
}

/**
 * Vercel cron target — identical behaviour, invoked on a schedule.
 *
 * CRON: vercel.json runs the schedule `0 [star]/6 * * *` (star = literal *),
 * i.e. every 6 hours (4x/day). Deliberately conservative for the $13 budget
 * (CLAUDE.md §5): each fired check does zero LLM work when the inbox is empty,
 * and at most MAX_PER_CHECK runs when it is not. (vercel.json is strict JSON and
 * cannot carry this comment, so it lives here.)
 */
export async function GET(): Promise<Response> {
  return handle();
}
