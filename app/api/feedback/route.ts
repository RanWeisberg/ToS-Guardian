/**
 * app/api/feedback/route.ts — the report-feedback write route (Phase 7 Step D).
 *
 * ADDITIVE and independent of the core: a thin adapter over the pure feedback
 * core (lib/feedback.ts → applyReportFeedback). It is NOT part of the LLM `steps`
 * trace and does NOT use the /api/execute envelope. Its own shape is:
 *   request:  { reportId: string, stances: Record<string, "care"|"dont_care"> }
 *   success:  { ok: true,  answered: boolean }
 *   failure:  { ok: false, error: string }   (HTTP 400 bad input / 500 thrown)
 *
 * Stores/SDKs used downstream require the Node runtime, not Edge.
 */

import { applyReportFeedback } from "@/lib/feedback";
import type { FeedbackStance } from "@/lib/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeedbackRequest {
  reportId: string;
  stances: Record<string, FeedbackStance>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<FeedbackRequest>;
    const reportId = body?.reportId;
    const stances = body?.stances;

    if (typeof reportId !== "string" || reportId.trim() === "") {
      return Response.json(
        { ok: false, error: "Request body must include a non-empty string `reportId`." },
        { status: 400 },
      );
    }
    if (!isPlainObject(stances)) {
      return Response.json(
        { ok: false, error: "Request body must include a `stances` object." },
        { status: 400 },
      );
    }
    for (const [caseId, stance] of Object.entries(stances)) {
      if (stance !== "care" && stance !== "dont_care") {
        return Response.json(
          {
            ok: false,
            error: `Invalid stance "${String(stance)}" for "${caseId}" (expected "care" or "dont_care").`,
          },
          { status: 400 },
        );
      }
    }

    const { answered } = await applyReportFeedback(
      reportId,
      stances as Record<string, FeedbackStance>,
    );
    return Response.json({ ok: true, answered });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}