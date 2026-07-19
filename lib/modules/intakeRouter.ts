/**
 * lib/modules/intakeRouter.ts — Module 1 of the eight-module core (PROJECT_SPEC §4).
 *
 * IntakeRouter classifies the raw input (onboarding / change-notice / out-of-scope),
 * extracts the service + category, and detects whether the agreement arrived inline
 * or behind a link. It is the first genuine-judgment step in the "agent, not pipeline"
 * story (PROJECT_SPEC §4).
 *
 * Contract: implements the frozen IntakeRouterInput → IntakeRouterOutput shape from
 * lib/contracts.ts. It makes EXACTLY ONE LLM call (CLAUDE.md §4/§5) and records that
 * call as EXACTLY ONE Step via the tracer.
 */

import type { IntakeRouterInput, IntakeRouterOutput, IntakeKind, DocumentSource } from "@/lib/contracts";
import { MODULES } from "@/lib/modules";
import { chat } from "@/lib/llmod";
import type { Tracer } from "@/lib/trace";

const SYSTEM_PROMPT = `You are the IntakeRouter for ToS Guardian, an agent that reads terms-of-service and privacy agreements. Classify one user input and extract structured fields.

Return STRICT JSON ONLY — no prose, no explanation, no markdown code fences. The object must have exactly these fields:

- "kind": one of "onboarding", "change_notice", "out_of_scope".
    * "onboarding"     = the user is pasting or naming an agreement they are signing up to (the terms you accept at signup).
    * "change_notice"  = a terms-update notification (an email or notice saying the terms changed).
    * "out_of_scope"   = anything that is not about a terms-of-service or privacy agreement.
- "service": the name of the service the agreement belongs to (e.g. "Spotify"), or null if it cannot be determined.
- "category": the kind of service (e.g. "music streaming", "social network", "cloud storage"), or null if it cannot be determined.
- "source": "inline" if the actual agreement text is present in the input; "linked" if the input only references or links to a policy.
- "inline_text": when source is "inline", the agreement text itself; otherwise null.
- "link_url": when source is "linked", the URL of the policy; otherwise null.

Rules:
- If the actual agreement text is present in the input, set source="inline", inline_text=that text, link_url=null.
- If the input only references or links to a policy (no full text), set source="linked", link_url=the URL, inline_text=null.
- For "out_of_scope" input, still fill source/inline_text/link_url as best you can from the same rules.
- Output must be a single JSON object and nothing else.`;

const VALID_KINDS: readonly IntakeKind[] = ["onboarding", "change_notice", "out_of_scope"];
const VALID_SOURCES: readonly DocumentSource[] = ["inline", "linked"];

/** Strip an accidental ```json … ``` (or plain ``` … ```) fence the model may add. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const m = trimmed.match(fence);
  return (m ? m[1] : trimmed).trim();
}

export async function runIntakeRouter(
  input: IntakeRouterInput,
  tracer: Tracer,
): Promise<IntakeRouterOutput> {
  const system_prompt = SYSTEM_PROMPT;
  const user_prompt = input.prompt;

  const raw = await chat({ system_prompt, user_prompt });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error(
      `IntakeRouter: model did not return valid JSON. Got: ${raw.slice(0, 500)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`IntakeRouter: expected a JSON object, got: ${raw.slice(0, 500)}`);
  }

  const obj = parsed as Record<string, unknown>;

  const kind = obj.kind;
  if (typeof kind !== "string" || !VALID_KINDS.includes(kind as IntakeKind)) {
    throw new Error(
      `IntakeRouter: missing or invalid "kind" (expected one of ${VALID_KINDS.join(", ")}). Got: ${String(kind)}`,
    );
  }

  const source = obj.source;
  if (typeof source !== "string" || !VALID_SOURCES.includes(source as DocumentSource)) {
    throw new Error(
      `IntakeRouter: missing or invalid "source" (expected one of ${VALID_SOURCES.join(", ")}). Got: ${String(source)}`,
    );
  }

  const service = normalizeNullableString(obj.service, "service");
  const category = normalizeNullableString(obj.category, "category");
  const inline_text = normalizeNullableString(obj.inline_text, "inline_text");
  const link_url = normalizeNullableString(obj.link_url, "link_url");

  const output: IntakeRouterOutput = {
    kind: kind as IntakeKind,
    service,
    category,
    source: source as DocumentSource,
    inline_text,
    link_url,
  };

  tracer.add({
    module: MODULES.IntakeRouter,
    prompt: { system_prompt, user_prompt },
    response: output,
  });

  return output;
}

/** A field that is either a non-empty string or null. Rejects wrong types loudly. */
function normalizeNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  throw new Error(`IntakeRouter: field "${field}" must be a string or null. Got: ${typeof value}`);
}
