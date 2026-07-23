/**
 * app/api/preferences/route.ts — the preference-write route.
 *
 * ADDITIVE and independent of the core (NOT part of the LLM `steps` trace and does
 * NOT use the /api/execute envelope). As of migration step 4b it writes the ANSWER
 * LOG (`answers` table), not the retired `preferences` table:
 *   request:  { case_id, category, stance: "care"|"dont_care", clause?, explanation? }
 *   success:  { ok: true }
 *   failure:  { ok: false, error: string }   (HTTP 400 bad input / 500 thrown)
 *
 * Behavior: if any answer row already exists for (case_id × category), set its
 * stance in place; otherwise create a STANDALONE answer row (a first-time stance
 * set from the Preferences tab), using the provided clause/explanation and falling
 * back to the ToS;DR taxonomy title/description when absent.
 *
 * Stores/SDKs used downstream require the Node runtime, not Edge.
 */

import { setStanceForCase, setStandaloneStance } from "@/lib/db";
import type { Preference } from "@/lib/db";
import tosdrCases from "@/data/tosdr_cases.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PreferenceRequest {
  case_id: string;
  category: string;
  stance: Preference["stance"];
  clause?: string;
  explanation?: string;
}

/** Taxonomy fallback text, keyed by case_id (as string). */
const TAXONOMY = new Map<string, { title: string; description: string }>(
  (tosdrCases as unknown as { case_id: number | string; title: string; description: string }[]).map(
    (c) => [String(c.case_id), { title: c.title, description: c.description }],
  ),
);

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<PreferenceRequest>;
    const { case_id, category, stance, clause, explanation } = body;

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

    // Update any existing rows for this (case × category); if none, write a
    // standalone row with the given text (falling back to the taxonomy).
    const updated = await setStanceForCase(case_id, category, stance);
    if (updated === 0) {
      const tax = TAXONOMY.get(case_id);
      await setStandaloneStance({
        case_id,
        category,
        clause: (clause ?? "").trim() || tax?.title || case_id,
        explanation: (explanation ?? "").trim() || tax?.description || "",
        stance,
      });
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}