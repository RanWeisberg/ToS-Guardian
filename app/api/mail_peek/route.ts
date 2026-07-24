/**
 * app/api/mail_peek/route.ts — the FREE inbox peek (phase 1 of the header button).
 *
 * ADDITIVE and independent of the core: it lists the currently-unprocessed change
 * notices ONCE via the selected MailSource's fetchNewChangeNotices() and reports
 * how many there are — it does NOT call runAgent and does NOT markProcessed, so it
 * spends ZERO tokens and marks nothing. Phase 2 (POST /api/mail_check) re-lists and
 * actually processes; because peek marked nothing, the same emails are still
 * unprocessed and nothing is double-processed.
 *
 *   success: { status:"ok",    error:null, count, services }
 *   failure: { status:"error", error,       count:0, services:[] }   (HTTP 500)
 *
 * NOT part of the /api/execute envelope or the LLM `steps` trace. Node runtime
 * (the Gmail/Supabase sources need it).
 */

import { selectMailSource } from "@/lib/mail/selectSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(): Promise<Response> {
  try {
    const notices = await selectMailSource().fetchNewChangeNotices();
    return Response.json({
      status: "ok",
      error: null,
      count: notices.length,
      services: notices.map((n) => n.service_hint),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { status: "error", error: message, count: 0, services: [] },
      { status: 500 },
    );
  }
}

/** The header button's phase-1 peek POSTs here. */
export async function POST(): Promise<Response> {
  return handle();
}

/** Convenience manual GET (identical behaviour) — handy for a curl check. */
export async function GET(): Promise<Response> {
  return handle();
}