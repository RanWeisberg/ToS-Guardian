/**
 * lib/llmod.ts — the LLMod.ai client wrapper (CLAUDE.md §6).
 *
 * The single place the app talks to the LLMod.ai OpenAI-compatible endpoint.
 * Secrets and model ids come from lib/config.ts — nothing here reads
 * process.env directly, and no key is ever logged.
 *
 * This wrapper deliberately does NOT touch the tracer: `chat()` returns the
 * completion text and the caller records its own Step (module name + the exact
 * prompts it sent + the response). That keeps the `steps` trace owned by the
 * modules, where the module identity actually lives (CLAUDE.md §4, §7).
 *
 * The OpenAI SDK requires the Node runtime, not Edge.
 */

import OpenAI from "openai";
import {
  LLMOD_API_KEY,
  LLMOD_BASE_URL,
  LLMOD_TEXT_MODEL,
  LLMOD_EMBED_MODEL,
} from "@/lib/config";

/** One shared SDK client, created lazily on first use (config validated at
 *  import time in lib/config.ts). This is client init, not cross-call app
 *  state — no application state is cached here (CLAUDE.md §2). */
let client: OpenAI | null = null;
function llmod(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: LLMOD_API_KEY!, baseURL: LLMOD_BASE_URL! });
  }
  return client;
}

/** The prompt pair every text call sends — same shape a Step records. */
export interface ChatPrompt {
  system_prompt: string;
  user_prompt: string;
}

/**
 * Run one text completion against LLMOD_TEXT_MODEL and return the assistant
 * text. The caller already holds `system_prompt` / `user_prompt`, so together
 * with this return value it has everything needed to append a Step.
 */
export async function chat({ system_prompt, user_prompt }: ChatPrompt): Promise<string> {
  const completion = await llmod().chat.completions.create({
    model: LLMOD_TEXT_MODEL!,
    messages: [
      { role: "system", content: system_prompt },
      { role: "user", content: user_prompt },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

/**
 * Embed a batch of texts with LLMOD_EMBED_MODEL. Array in, array out, aligned
 * by index — callers must batch here rather than looping one clause at a time
 * (budget: CLAUDE.md §5). An empty input short-circuits without a network call.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await llmod().embeddings.create({
    model: LLMOD_EMBED_MODEL!,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}