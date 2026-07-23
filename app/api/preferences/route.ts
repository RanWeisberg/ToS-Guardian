/**
 * app/api/preferences/route.ts — the preference-write route (Chunk B).
 *
 * ADDITIVE and independent of the core: a thin adapter over db.upsertPreferences
 * (the single source of truth for writing user preferences). It is NOT part of
 * the LLM `steps` trace and does NOT use the /api/execute envelope. Its own shape:
 *   request:  { case_id: string, category: string, stance: "care"|"dont_care" }
 *   success:  { ok: true }
 *   failure:  { ok: false, error: string }   (HTTP 400 bad input / 500 thrown)
 *
 * Stores/SDKs used downstream require the Node runtime, not Edge.
 */

import { upsertPreferences } from "@/lib/db";
import type { Preference } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PreferenceRequest {
  case_id: string;
  category: string;
  stance: Preference["stance"];
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<PreferenceRequest>;
    const { case_id, category, stance } = body;

    if (typeof case_id !== "string" || case_id.trim() === "") {
      return Response.json(
        { ok: false, error: "Request body must include a non-empty string `case_id`." },
        { status: 400 },
      );
    }
    if (typeof category !== "string" || category.trim() === "") {
      return Response.json(
        { ok: false, error: "Request body must include a non-empty string `category`." },
        { status: 400 },
      );
    }
    if (stance !== "care" && stance !== "dont_care") {
      return Response.json(
        {
          ok: false,
          error: `Invalid stance "${String(stance)}" (expected "care" or "dont_care").`,
        },
        { status: 400 },
      );
    }

    await upsertPreferences([{ case_id, category, stance }]);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
