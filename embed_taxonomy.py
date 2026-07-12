"""
embed_taxonomy.py — embed the ToS;DR case taxonomy into Pinecone.

Reads data/tosdr_cases.json (produced by fetch_taxonomy.py), embeds each case
with LLMod.ai's text-embedding model, and upserts one vector per case into
Pinecone. Idempotent: re-running overwrites cleanly.

    python scripts/embed_taxonomy.py

Requires a filled .env (LLMOD_API_KEY, LLMOD_BASE_URL, PINECONE_API_KEY).
"""

import json
import os
import sys
import time

import config
from openai import OpenAI
from pinecone import Pinecone, ServerlessSpec

INPUT_PATH = os.path.join("data", "tosdr_cases.json")
BATCH_SIZE = 64
SAMPLE_QUERY = "the service can change its terms at any time"


def load_cases() -> list[dict]:
    if not os.path.exists(INPUT_PATH):
        sys.exit(f"Missing {INPUT_PATH}. Run fetch_taxonomy.py first.")
    with open(INPUT_PATH, encoding="utf-8") as f:
        cases = json.load(f)
    if not cases:
        sys.exit(f"{INPUT_PATH} is empty.")
    return cases


def embed_text_for(case: dict) -> str:
    """Text we actually embed: the title plus its description."""
    title = case["title"].strip()
    desc = (case.get("description") or "").strip()
    return f"{title}. {desc}".replace("\n", " ").strip()


def embed(client: OpenAI, texts: list[str]) -> list[list[float]]:
    """Embed a batch. On failure, stop loudly so we can check the endpoint."""
    try:
        resp = client.embeddings.create(model=config.LLMOD_EMBED_MODEL, input=texts)
    except Exception as e:  # noqa: BLE001 — we want the raw error surfaced
        print("\nEMBEDDING CALL FAILED. Raw error below.")
        print("Confirm LLMOD_BASE_URL and LLMOD_EMBED_MODEL in your .env against")
        print("the LLMod.ai dashboard (is the embeddings endpoint OpenAI-compatible?).\n")
        raise SystemExit(e)
    # Preserve input order.
    return [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]


def build_metadata(case: dict) -> dict:
    """
    Pinecone metadata cannot contain None. Include only the fields that are
    present; keep description so the agent can read it back at analysis time.
    """
    md = {}
    for key in ("case_id", "title", "description", "classification",
                "weight", "topic_id", "topic_name"):
        val = case.get(key)
        if val is not None:
            md[key] = val
    return md


def ensure_index(pc: Pinecone, dimension: int) -> None:
    name = config.PINECONE_INDEX_NAME
    if pc.has_index(name):
        existing = pc.describe_index(name).dimension
        if existing != dimension:
            sys.exit(
                f"Index '{name}' already exists with dimension {existing}, "
                f"but the embeddings are dimension {dimension}. Delete the old "
                f"index or use a different PINECONE_INDEX_NAME."
            )
        print(f"Using existing index '{name}' (dim {dimension}).")
        return

    print(f"Creating index '{name}' (dim {dimension}, cosine)...")
    pc.create_index(
        name=name,
        dimension=dimension,
        metric="cosine",
        spec=ServerlessSpec(cloud=config.PINECONE_CLOUD, region=config.PINECONE_REGION),
    )
    while not pc.describe_index(name).status["ready"]:
        time.sleep(1)
    print("Index ready.")


def main() -> None:
    config.summary()
    cases = load_cases()
    print(f"\nLoaded {len(cases)} cases from {INPUT_PATH}.")

    client = OpenAI(api_key=config.LLMOD_API_KEY, base_url=config.LLMOD_BASE_URL)
    pc = Pinecone(api_key=config.PINECONE_API_KEY)

    # Detect the true embedding dimension at runtime, then size the index to it.
    print("Detecting embedding dimension...")
    dim = len(embed(client, [embed_text_for(cases[0])])[0])
    print(f"Embedding dimension: {dim}")
    ensure_index(pc, dim)
    index = pc.Index(config.PINECONE_INDEX_NAME)

    # Embed + upsert in batches.
    total = 0
    for start in range(0, len(cases), BATCH_SIZE):
        batch = cases[start:start + BATCH_SIZE]
        vectors = embed(client, [embed_text_for(c) for c in batch])
        payload = [
            {
                "id": f"case-{c['case_id']}",
                "values": vec,
                "metadata": build_metadata(c),
            }
            for c, vec in zip(batch, vectors)
        ]
        index.upsert(vectors=payload)
        total += len(payload)
        print(f"  upserted {total}/{len(cases)}")

    # Verify.
    time.sleep(2)  # give stats a moment to settle
    stats = index.describe_index_stats()
    print(f"\nIndex vector count: {stats.get('total_vector_count')}")

    print(f'\nSample query: "{SAMPLE_QUERY}"')
    qvec = embed(client, [SAMPLE_QUERY])[0]
    res = index.query(vector=qvec, top_k=3, include_metadata=True)
    for m in res["matches"]:
        md = m["metadata"]
        print(f"  {m['score']:.3f}  [{md.get('classification')}]  {md.get('title')}")

    print("\nDone.")


if __name__ == "__main__":
    main()
