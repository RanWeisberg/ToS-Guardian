/**
 * app/api/team_info/route.ts — GET /api/team_info (PROJECT_SPEC §6, CLAUDE.md §6).
 *
 * Static team identity: name, members, and (placeholder) order number. No LLM, no
 * store calls — just a JSON constant. Node runtime for consistency with the rest of
 * the API surface.
 */

export const runtime = "nodejs";

const TEAM_INFO = {
  team_name: "מעיין ישי ורן",
  members: ["Ran Weisberg", "Maayan Mor", "Ishai Assulin"],
  order_number: "TODO", // course did not assign one; placeholder to fill if needed
} as const;

export async function GET(): Promise<Response> {
  return Response.json(TEAM_INFO);
}