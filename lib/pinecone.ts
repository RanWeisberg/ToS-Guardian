/**
 * lib/pinecone.ts — a thin, read-only query helper for the ToS;DR case index.
 *
 * The 236-case ToS;DR taxonomy is already embedded and upserted into
 * PINECONE_INDEX_NAME by the finished Python ingestion (do not touch it). This
 * module only READS: embed a clause elsewhere, then `queryCases()` the nearest
 * cases. No upserts, no index management.
 *
 * The Pinecone SDK requires the Node runtime, not Edge.
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { PINECONE_API_KEY, PINECONE_INDEX_NAME } from "@/lib/config";

/**
 * One nearest-case match with its metadata, as stored by the ingestion.
 *
 * NOTE: the ingestion stores `topic_id` + `topic_name` (see embed_taxonomy.py),
 * not a single `topic` field. Both real fields are exposed; `topic` is a
 * convenience alias of `topic_name` for callers that just want a label.
 */
export interface CaseMatch {
  case_id: string;
  title: string;
  description: string;
  classification: string; // good | neutral | bad | blocker (per ToS;DR)
  weight: number;
  topic_id: string;
  topic_name: string;
  topic: string; // alias of topic_name for convenience
  score: number; // cosine similarity from Pinecone
}

/** One shared client, created lazily on first use. */
let pinecone: Pinecone | null = null;
function index() {
  if (!pinecone) {
    pinecone = new Pinecone({ apiKey: PINECONE_API_KEY! });
  }
  return pinecone.index(PINECONE_INDEX_NAME!);
}

/**
 * Query the case index for the `topK` nearest ToS;DR cases to `vector` and
 * return their metadata. Read-only.
 */
export async function queryCases(vector: number[], topK: number): Promise<CaseMatch[]> {
  const res = await index().query({ vector, topK, includeMetadata: true });
  return (res.matches ?? []).map((m) => {
    const md = (m.metadata ?? {}) as Record<string, unknown>;
    const topicName = md.topic_name != null ? String(md.topic_name) : "";
    return {
      case_id: md.case_id != null ? String(md.case_id) : "",
      title: md.title != null ? String(md.title) : "",
      description: md.description != null ? String(md.description) : "",
      classification: md.classification != null ? String(md.classification) : "",
      weight: md.weight != null ? Number(md.weight) : 0,
      topic_id: md.topic_id != null ? String(md.topic_id) : "",
      topic_name: topicName,
      topic: topicName,
      score: m.score ?? 0,
    };
  });
}
