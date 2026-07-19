/**
 * app/api/execute/route.ts — the single core entry point (CLAUDE.md §4).
 *
 * PHASE 2 STUB. This proves the envelope + tracer end-to-end: parse { prompt },
 * create a Tracer, record one placeholder Step, and return a valid
 * ExecuteResponse. Real eight-module orchestration arrives in Phase 4.
 *
 * The core is pure: input → { response, steps }. The mail/cron layer will be a
 * thin adapter over this same handler and is NOT part of the steps trace.
 *
 * These stores/SDKs (added later) require the Node runtime, not Edge.
 */

import { MODULES } from "@/lib/modules";
import { Tracer } from "@/lib/trace";
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

    const tracer = new Tracer();

    // Placeholder Step — replaced by real module calls in Phase 4.
    tracer.add({
      module: MODULES.IntakeRouter,
      prompt: {
        system_prompt: "phase 2 stub",
        user_prompt: prompt,
      },
      response: { note: "phase 2 stub" },
    });

    const ok: ExecuteResponse = {
      status: "ok",
      error: null,
      response: "stub",
      steps: tracer.steps,
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
