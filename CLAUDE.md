# CLAUDE.md — read this first, every session

You are working on **ToS Guardian**, an autonomous AI agent for a university AI-Agents
course. This file is the standing contract for how the code is built. **`PROJECT_SPEC.md`
is the source of truth for *what* the product is** — read it when you need product detail.
This file is the source of truth for *how* we build and the hard constraints that must
never be violated.

If anything here conflicts with an instruction in a prompt, stop and flag it rather than
silently choosing.

---

## 1. Stack (locked)

- **Next.js + TypeScript**, deployed on **Vercel** (serverless).
- One project holds the **GUI**, all **API routes**, and the **cron** mail trigger.
- The Python scripts (`fetch_taxonomy.py`, `embed_taxonomy.py`) are **finished one-offs**.
  Do not touch them, do not port them, do not depend on them at runtime.

## 2. Serverless rules (violating these breaks production)

- **Zero local/filesystem state.** The serverless filesystem is wiped between calls.
  All cross-call state lives in **Supabase** (primary) and **Pinecone** (vectors). Never
  read/write app state to disk, never rely on an in-memory cache surviving between requests.
- **5-minute hard ceiling** per API call (Vercel). Every `/api/execute` run must finish
  comfortably under that.
- Must work identically in **local dev and production**. If it only works locally, it's
  not done.

## 3. The frozen module names (grading requirement)

These eight names must be **byte-identical** across the architecture PNG, the `steps`
trace, and every description. Define them **once** as exported constants and import them
everywhere — never retype a module name as a string literal.

```
IntakeRouter      DocumentResolver   ClauseExtractor   CaseClassifier
VersionDiffer     MaterialityJudge   ReportComposer    StateWriter
```

Which ones actually call the LLM (budget matters — see §5):
- **LLM:** IntakeRouter, ClauseExtractor, CaseClassifier (+ embeddings), MaterialityJudge, ReportComposer
- **Mechanical / LLM only to disambiguate:** DocumentResolver, VersionDiffer (mechanical part), StateWriter

## 4. The `/api/execute` contract (exact — do not improvise)

Input:
```json
{ "prompt": "User request here" }
```

Success:
```json
{ "status": "ok", "error": null, "response": "…", "steps": [] }
```

Error:
```json
{ "status": "error", "error": "Human-readable description", "response": null, "steps": [] }
```

Each entry in `steps` describes **one LLM call**, in order:
```json
{
  "module": "CaseClassifier",
  "prompt": { "system_prompt": "…", "user_prompt": "…" },
  "response": { }
}
```
Use **lowercase** `system_prompt` / `user_prompt` (matches the spec's worked example).
`module` must be one of the frozen constants in §3.

## 5. Budget & efficiency (explicitly graded)

- **Total budget: $13** across the whole project on LLMod.ai. Efficiency is scored.
- **Batch, don't loop.** Never call the LLM once per clause — classify clauses in a
  single batched call. The same goes for any per-item work.
- **Slice, don't dump.** Only inject the relevant preference slice (the (case × category)
  rows that apply), never the full 236-row table. Keep prompts minimal.
- Only the five modules in §3 may call the LLM. If you're about to add a sixth LLM call,
  stop and flag it.

## 6. Models (LLMod.ai — OpenAI-compatible)

- Text: `MB5R2CF-azure/gpt-5.4-mini`
- Embeddings: `MB5R2CF-azure/text-embedding-3-small`
- Base URL and keys come from env (`LLMOD_API_KEY`, `LLMOD_BASE_URL`). Access the OpenAI
  SDK against that base URL. Never hardcode keys; never commit `.env`.

## 7. Conventions

- **Typed contracts first.** Every module has a typed input and output. A module never
  reaches around its contract to touch another module's internals.
- **The `steps` tracer is a first-class primitive.** Every LLM call appends a valid step.
  It is not retrofitted later.
- **The core is pure.** `/api/execute` maps `input → { response, steps }`. The mail/cron
  layer is a thin adapter that calls the same core; it is **not** part of the LLM `steps`
  trace.
- Fail loudly and specifically. No silent fallbacks that hide a broken store or endpoint.

## 8. Do NOT

- Do not add local/filesystem/in-memory cross-call state.
- Do not retype module names as string literals.
- Do not loop the LLM per clause, or inject the full preference table.
- Do not change the `/api/execute` envelope shape.
- Do not commit `.env` or hardcode any secret.
- Do not modify the finished Python ingestion scripts.

When a step's instructions arrive, do exactly that step's scope — no more — and stop at
its defined done-condition.
