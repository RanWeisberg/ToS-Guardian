/**
 * app/api/team_info/route.ts — GET /api/team_info (PROJECT_SPEC §6, CLAUDE.md §6).
 *
 * Static team identity in the assignment's EXACT shape — the three top-level keys
 * (group_batch_order_number, team_name, students) and the students[].{name,email}
 * fields are graded literally, so they must not be renamed or reordered away.
 *
 * No LLM, no store calls — just a JSON constant, so this stays a fast GET. Node
 * runtime for consistency with the rest of the API surface.
 */

export const runtime = "nodejs";

const TEAM_INFO = {
  group_batch_order_number: "1_10",
  team_name: "Ran, Maayan, ishai",
  students: [
    { name: "Ran Weisberg", email: "ranweisberg@campus.technion.ac.il" },
    { name: "Ishai Assulin", email: "Ishaiassulin@campus.technion.ac.il" },
    { name: "Maayan Mor", email: "maayan-mor@campus.technion.ac.il" },
  ],
} as const;

export async function GET(): Promise<Response> {
  return Response.json(TEAM_INFO);
}