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
import type { ExecuteRequest, ExecuteResponse } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const { response, steps } = await runAgent(prompt);

    const ok: ExecuteResponse = {
      status: "ok",
      error: null,
      response,
      steps,
    };
    return Response.json(ok);
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