/**
 * app/api/healthcheck/route.ts — Phase 0 connectivity diagnostic.
 *
 * Runs four INDEPENDENT checks against the external services the agent depends
 * on. Each check is wrapped in its own try/catch so one failure can never mask
 * the others, and they run concurrently. The response reports only booleans and
 * small non-sensitive details — never a key or secret value.
 *
 * These SDKs (openai, pinecone, supabase) require the Node runtime, not Edge.
 */

import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import { createClient } from "@supabase/supabase-js";
import {
  LLMOD_API_KEY,
  LLMOD_BASE_URL,
  LLMOD_TEXT_MODEL,
  LLMOD_EMBED_MODEL,
  PINECONE_API_KEY,
  PINECONE_INDEX_NAME,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail?: string; [key: string]: unknown };

/** Extract a short, secret-free message from an unknown thrown value. */
function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

function llmodClient(): OpenAI {
  return new OpenAI({ apiKey: LLMOD_API_KEY!, baseURL: LLMOD_BASE_URL! });
}

async function checkLlmodChat(): Promise<Check> {
  try {
    const client = llmodClient();
    const completion = await client.chat.completions.create({
      model: LLMOD_TEXT_MODEL!,
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
    });
    const ok = Array.isArray(completion.choices) && completion.choices.length > 0;
    return {
      ok,
      detail: ok ? "chat completion returned" : "no choices returned",
      model: LLMOD_TEXT_MODEL,
    };
  } catch (err) {
    return { ok: false, detail: errMessage(err) };
  }
}

async function checkLlmodEmbed(): Promise<Check> {
  try {
    const client = llmodClient();
    const res = await client.embeddings.create({
      model: LLMOD_EMBED_MODEL!,
      input: "ToS Guardian healthcheck",
    });
    const dimension = res.data[0]?.embedding.length ?? 0;
    return {
      ok: dimension > 0,
      dimension,
      detail: `expected 1536, got ${dimension}`,
      model: LLMOD_EMBED_MODEL,
    };
  } catch (err) {
    return { ok: false, detail: errMessage(err) };
  }
}

async function checkPinecone(): Promise<Check> {
  try {
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY! });
    const index = pc.index(PINECONE_INDEX_NAME!);
    const stats = await index.describeIndexStats();
    // SDK versions differ: newer exposes totalRecordCount, older totalVectorCount.
    const s = stats as unknown as {
      totalRecordCount?: number;
      totalVectorCount?: number;
    };
    const count = s.totalRecordCount ?? s.totalVectorCount ?? null;
    return {
      ok: count !== null,
      count,
      detail: `expected ~236, got ${count}`,
      index: PINECONE_INDEX_NAME,
    };
  } catch (err) {
    return { ok: false, detail: errMessage(err) };
  }
}

async function checkSupabase(): Promise<Check> {
  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Insert (defaults only) → read back by id → delete. ok only if all three pass.
    const inserted = await supabase.from("_healthcheck").insert({}).select().single();
    if (inserted.error) throw inserted.error;
    const id = (inserted.data as { id: unknown }).id;

    const selected = await supabase.from("_healthcheck").select("*").eq("id", id).single();
    if (selected.error) throw selected.error;

    const deleted = await supabase.from("_healthcheck").delete().eq("id", id);
    if (deleted.error) throw deleted.error;

    return { ok: true, detail: "insert + select + delete round-trip succeeded" };
  } catch (err) {
    return { ok: false, detail: errMessage(err) };
  }
}

export async function GET() {
  const [llmod_chat, llmod_embed, pinecone, supabase] = await Promise.all([
    checkLlmodChat(),
    checkLlmodEmbed(),
    checkPinecone(),
    checkSupabase(),
  ]);

  return Response.json({ llmod_chat, llmod_embed, pinecone, supabase });
}