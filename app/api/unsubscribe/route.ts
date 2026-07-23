/**
 * app/api/unsubscribe/route.ts — soft-unsubscribe a tracked service.
 *
 * ADDITIVE and independent of the core (NOT part of the LLM `steps` trace and does
 * NOT use the /api/execute envelope). It flips active=false on all of a service's
 * agreement_versions rows via db.unsubscribeService; re-subscribe is automatic when
 * a new agreement arrives (StateWriter sets active=true).
 *   request:  { service: string }
 *   success:  { ok: true }
 *   failure:  { ok: false, error: string }   (HTTP 400 bad input / 500 thrown)
 *
 * Stores/SDKs used downstream require the Node runtime, not Edge.
 */

import { unsubscribeService } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UnsubscribeRequest {
  service: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<UnsubscribeRequest>;
    const { service } = body;

    if (typeof service !== "string" || service.trim() === "") {
      return Response.json(
        { ok: false, error: "Request body must include a non-empty string `service`." },
        { status: 400 },
      );
    }

    await unsubscribeService(service);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}