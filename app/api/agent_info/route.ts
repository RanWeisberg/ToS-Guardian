/**
 * app/api/agent_info/route.ts — GET /api/agent_info (PROJECT_SPEC §6, CLAUDE.md §6).
 *
 * Returns the agent's static description, purpose, prompt template, and worked
 * examples with full step traces, in the assignment's exact shape:
 *   { description, purpose, prompt_template: { template, example },
 *     prompt_examples: [ { prompt, full_response, steps } ] }
 *
 * The worked example is STORED (captured once via scripts-ts/capture_example.ts and
 * copied to ./example.json) — there is NO live /api/execute call at request time, so
 * this endpoint is fast and spends zero tokens. The steps array is kept EXACTLY as
 * captured (the full 5-step trace), so its module names stay byte-identical to the
 * live trace and the architecture diagram (CLAUDE.md §3) — never retyped here.
 *
 * Node runtime, consistent with the other GET endpoints.
 */

import exampleEnvelope from "./example.json";
import examplePromptData from "./examplePrompt.json";

export const runtime = "nodejs";

/** The captured /api/execute envelope, narrowed to what this route surfaces. */
interface CapturedEnvelope {
  response: string | null;
  steps: unknown[];
}
const example = exampleEnvelope as unknown as CapturedEnvelope;
const examplePrompt = (examplePromptData as unknown as { prompt: string }).prompt;

const DESCRIPTION =
  "An autonomous terms-of-service and privacy-policy guardian. You tell it which service you're signing up for and paste the agreement; it reads the fine print, maps each clause onto the ToS;DR case taxonomy via semantic retrieval, weighs each finding against what you've told it you care about, and returns only the terms that genuinely matter to you — in plain language.\n\nWhat it CAN do: review a pasted agreement for a named service, identify problematic clauses (data selling, indefinite retention, forced arbitration, unilateral term changes, etc.), explain why each matters to you, learn your preferences from your feedback so future reviews are personalized, track the services you're subscribed to, and re-flag standing issues when your preferences change — without re-running the model.\n\nWhat it CANNOT do: it does not provide legal advice or a substitute for a lawyer; it reviews the text you give it and does not fetch agreements on its own from the web; and it flags concerns based on the ToS;DR taxonomy rather than exhaustively catching every possible clause.";

const PURPOSE =
  "Cut through dense legal agreements so you understand what you're actually agreeing to — surfacing only the clauses that matter to you, in plain language, before you click 'I agree'.";

const AGENT_INFO = {
  description: DESCRIPTION,
  purpose: PURPOSE,
  prompt_template: {
    template:
      "I'm signing up for <service name>. Here is the agreement I'm being asked to accept:\n\n<paste the full terms-of-service or privacy policy text>",
    example:
      "I'm signing up for Grammarly. Here is the agreement I'm being asked to accept:\n\n<Grammarly terms text>",
  },
  prompt_examples: [
    {
      prompt: examplePrompt,
      full_response: example.response,
      steps: example.steps,
    },
  ],
};

export async function GET(): Promise<Response> {
  return Response.json(AGENT_INFO);
}