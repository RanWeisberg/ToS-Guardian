/**
 * lib/trace.ts — the `steps` tracer, a first-class primitive (CLAUDE.md §4, §7).
 *
 * One Tracer threads through the whole /api/execute pipeline. Every LLM call
 * appends exactly one ordered Step as it happens — the trace is never
 * retrofitted after the fact. Framework-free and tiny on purpose.
 */

import type { ModuleName } from "@/lib/modules";

/**
 * One recorded LLM call, in the exact shape the /api/execute contract requires
 * (CLAUDE.md §4). Note the lowercase `system_prompt` / `user_prompt` keys.
 */
export type Step = {
  module: ModuleName;
  prompt: { system_prompt: string; user_prompt: string };
  response: unknown;
};

/**
 * Accumulates an ordered list of Steps. Modules call `add()` right after each
 * LLM call; the orchestrator reads `steps` at the end to build the response.
 */
export class Tracer {
  private readonly collected: Step[] = [];

  /** Append one Step to the ordered trace. */
  add(step: Step): void {
    this.collected.push(step);
  }

  /** The steps recorded so far, in call order. Returns a copy — callers must
   *  not mutate the internal trace. */
  get steps(): Step[] {
    return [...this.collected];
  }
}
