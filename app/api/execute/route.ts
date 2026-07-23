/**
 * app/api/execute/route.ts — the single core entry point (CLAUDE.md §4).
 *
 * A thin adapter over the pure core: validate { prompt }, call runAgent, and map
 * its { response, steps } into the exact ExecuteResponse envelope. All eight-module
 * orchestration lives in lib/orchestrator.ts; this route owns only the HTTP shape.
 * The mail/cron layer will call runAgent the same way and is NOT part of the trace.
 *
 * Stores/SDKs used downstream require the Node runtime, not Edge.
 */

import { runAgent } from "@/lib/orchestrator";
import { insertReport, upsertAnswerRows } from "@/lib/db";
import type { ExecuteRequest, ExecuteResponse } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow the full pipeline the assignment's 5-min ceiling (and the Fluid-compute
// Hobby max) instead of Vercel's low default, so a real multi-LLM run isn't killed.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<ExecuteRequest>;
    const prompt = body?.prompt;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      const bad: ExecuteResponse = {
        status: "error",
        error: "Request body must include a non-empty string `prompt`.",
        response: null,
        steps: [],
      };
      return Response.json(bad, { status: 400 });
    }

    const { response, steps, report } = await runAgent(prompt);

    // Persist a report row for runs that produced one (source='manual'; the mail
    // path will persist with source='mail' later). Silent runs write nothing.
    // The new id is returned via the `X-Report-Id` response HEADER so the GUI can
    // open /report/[id] — the JSON envelope's four keys stay exactly as-is
    // ({status,error,response,steps}, response still a plain string, CLAUDE.md §4).
    let reportId: string | null = null;
    if (report) {
      reportId = await insertReport({ ...report, source: "manual" });
      // Answer-log bookkeeping (migration step 3): one row per finding,
      // answered=false, stamped with this run's agreement version. Upsert
      // semantics mean a re-review of the same service updates rows in place and
      // preserves prior answers. This is persistence, NOT part of the trace.
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

    const ok: ExecuteResponse = {
      status: "ok",
      error: null,
      response,
      steps,
    };
    const headers = reportId ? { "X-Report-Id": reportId } : undefined;
    return Response.json(ok, headers ? { headers } : undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorResponse: ExecuteResponse = {
      status: "error",
      error: message,
      response: null,
      steps: [],
    };
    return Response.json(errorResponse, { status: 500 });
  }
}