/**
 * app/api/agent_info/route.ts — GET /api/agent_info (PROJECT_SPEC §6, CLAUDE.md §6).
 *
 * Static description of the agent: what it is, its purpose, the shape of the prompt
 * /api/execute accepts, the eight core modules IN ORDER, and worked examples with step
 * traces (TODO placeholders, to be filled with real captured runs before the demo).
 *
 * The `modules` array is derived from the imported MODULES constant so the names stay
 * BYTE-IDENTICAL to the `steps` trace and the architecture diagram (CLAUDE.md §3) — they
 * are never retyped as string literals here. No live LLM call. Node runtime.
 */

import { MODULES } from "@/lib/modules";

export const runtime = "nodejs";

/** The eight frozen module names, in pipeline order (insertion order of MODULES). */
const MODULE_ORDER = Object.values(MODULES);

const AGENT_INFO = {
  name: "ToS Guardian",
  description:
    "ToS Guardian is an autonomous agent that reads the terms-of-service and privacy " +
    "agreements of the services a user relies on and maps each clause onto the ToS;DR " +
    "case taxonomy using retrieval-augmented generation. It compares a new agreement " +
    "against the version the user previously accepted to detect what MATERIALLY changed, " +
    "and it surfaces a personalized report only when a change actually matters — weighted " +
    "by that specific user's stated preferences.",
  purpose:
    "Turn the unread legal fine print of the services you use into personalized, " +
    "change-aware alerts, so you only hear about the terms that actually affect you.",
  prompt_template:
    "A single natural-language prompt describing one agreement event. It is either an " +
    "ONBOARDING request — the agreement the user is signing up to, pasted inline (or " +
    "given as a link) together with the service name and category — or a CHANGE NOTICE " +
    "that the terms of an already-known service have been updated. IntakeRouter classifies " +
    "which case it is (anything unrelated is treated as out-of-scope). " +
    'Example: "I\'m signing up for Acme Cloud, a cloud storage service, and I\'m being ' +
    'asked to accept these terms. What am I agreeing to? <full agreement text>".',
  modules: MODULE_ORDER,
  examples_note: "TODO: fill with real captured /api/execute runs before demo.",
  examples: [
    { prompt: "TODO", response: "TODO", steps: [] },
    { prompt: "TODO", response: "TODO", steps: [] },
  ],
} as const;

export async function GET(): Promise<Response> {
  return Response.json(AGENT_INFO);
}