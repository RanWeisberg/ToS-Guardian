# ToS Guardian

**ToS Guardian** is an autonomous agent that reads the fine print so you don't have to.
You tell it which service you're signing up for and paste the agreement; it reads the
terms, maps each clause onto the [ToS;DR](https://tosdr.org/) case taxonomy through
semantic retrieval, weighs each finding against what you've told it you care about, and
returns — in plain language — only the terms that actually matter to you.

Beyond one-off reviews, it keeps working: it tracks the services you're subscribed to,
learns your preferences from your feedback so future reviews get more personalized, and
can monitor a mailbox for terms-change notices and review them on demand — flagging what
changed without you ever reading the legalese.

## What it does

- **Reviews agreements** for a named service and surfaces problematic clauses — data
  selling, indefinite retention, forced arbitration, unilateral term changes, and more.
- **Explains why each clause matters to you**, in plain language rather than legal prose.
- **Compares versions.** When a service updates its terms, it diffs the new agreement
  against the stored one and reports only what genuinely changed — not what was reworded.
- **Learns your preferences.** Your answers to a report are remembered, so the agent gets
  better at judging what's material to *you* over time.
- **Tracks your services** and re-flags standing issues when your preferences change —
  without re-running the language model.
- **Monitors your inbox** (optional) for terms-change emails and reviews them on demand.

> ToS Guardian is not legal advice and is not a substitute for a lawyer. It reviews the
> text you give it and flags concerns based on the ToS;DR taxonomy.

## Architecture

ToS Guardian is a **deterministic orchestration graph with LLM-judgment nodes** — not a
free-form agent loop. The sequence of modules is fixed; the branches are decided by the
modules' own typed outputs. Two intake paths feed one shared core:

- **Manual path:** the agent GUI at `/` → `POST /api/execute`
- **Monitoring path:** the *Check mail* button → a free inbox peek → `/api/mail_check`

Both converge on **`runAgent`** (`lib/orchestrator.ts`), which runs eight modules in a
fixed order:

1. **IntakeRouter** — classifies the request (new agreement vs. change notice) and infers
   the service and its category. An out-of-scope prompt stops here.
2. **DocumentResolver** — obtains the agreement text, from the pasted body or a link. If
   it can't, the run stops and asks the user to paste.
3. **ClauseExtractor** — splits the agreement into individual clauses.
4. **CaseClassifier** — the RAG core: embeds each clause and matches it against the
   ToS;DR case taxonomy stored in Pinecone.
5. **VersionDiffer** — compares the new classifications against the stored version.
   Added and removed cases are decided mechanically; only cases whose clause wording
   changed go to one batched LLM call, which rules each *modified* or *unchanged*. On a
   first run there is no prior version, so everything is simply new.
6. **MaterialityJudge** — weighs each change against the user's answer history, using the
   ToS;DR taxonomy as an always-on base layer and letting the LLM resolve conflicts.
   Decides what is genuinely material.
7. **ReportComposer** — writes the plain-language report of what matters, or stays silent
   when nothing does.
8. **StateWriter** — persists the new agreement version and its classifications, and
   keeps the subscription list current. Always runs, even on a silent report, because the
   version store *is* the diff baseline.

**The `steps` trace.** Every LLM call appends exactly one ordered `Step` as it happens
(`lib/trace.ts`). `DocumentResolver` and `StateWriter` make no LLM call and never appear
in the trace. `VersionDiffer` appears only when a case was reworded and needed judgment.
So a first review returns a five-step trace and a change review returns up to six.

**Memory & stores:**
- **Pinecone** — the ToS;DR case taxonomy (236 cases): the agent's knowledge base.
- **Supabase** — the version store (`agreement_versions`, which also drives the
  subscription list), reports, and the **answer log** (`answers`) that records what the
  user has been shown and how they responded, keyed per service × case × category.
- **LLMod** — `gpt-5.4-mini` for reasoning and `text-embedding-3-small` for retrieval.
- **Gmail** (read-only, optional) — the monitored mailbox for change notices.

The full architecture diagram is served live at **`/api/model_architecture`**.

## API

Four graded endpoints:

- `POST /api/execute` — runs the agent on a prompt; returns `{ status, error, response, steps }`.
- `GET /api/agent_info` — the agent's description, purpose, prompt template, and a worked
  example with its full step trace.
- `GET /api/team_info` — the team behind the project.
- `GET /api/model_architecture` — the architecture diagram.

The GUI is backed by a few internal routes as well: `/api/mail_peek` and `/api/mail_check`
(the two-phase inbox check), `/api/feedback` and `/api/preferences` (the answer log),
`/api/unsubscribe`, and `/api/healthcheck` (a connectivity diagnostic that reports which
environment variables are set, by name only).

## Running it

**Requirements:** Node 20+, a Supabase project, a Pinecone index, and an LLMod API key.
Python 3.10+ is needed only to build the taxonomy index.

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev
```

**Environment** (`lib/config.ts` is the single place that reads it):

| Variable | Required | Notes |
| --- | --- | --- |
| `LLMOD_API_KEY`, `LLMOD_BASE_URL` | yes | model proxy |
| `LLMOD_TEXT_MODEL`, `LLMOD_EMBED_MODEL` | no | sensible defaults |
| `PINECONE_API_KEY` | yes | |
| `PINECONE_INDEX_NAME`, `PINECONE_CLOUD`, `PINECONE_REGION` | no | default to `tosdr-taxonomy` / `aws` / `us-east-1` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | yes | |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER` | no | without these the mail layer falls back to a mock source |

Hit `/api/healthcheck` to confirm what's wired up.

**Database.** Apply the SQL in `supabase/` in this order: `schema.sql`, `reports.sql`,
`answers.sql`, `processed_emails.sql`. (`mock_inbox.sql` is only for demoing the mail path
without Gmail; `drop_preferences.sql` is a historical migration.)

**Taxonomy index.** The ToS;DR cases are fetched and embedded once:

```bash
pip install -r requirements.txt
python fetch_taxonomy.py    # writes data/tosdr_cases.json
python embed_taxonomy.py    # upserts 236 cases into Pinecone
```

`data/tosdr_cases.json` is committed, so `fetch_taxonomy.py` is only needed to refresh it.

## Citation

```bibtex
@misc{tosguardian2026,
  author       = {Ran Weisberg and Maayan Mor and Ishai Assulin},
  title        = {ToS Guardian: An Autonomous Terms-of-Service and Privacy-Policy Review Agent},
  year         = {2026},
  institution  = {Technion --- Israel Institute of Technology},
  howpublished = {\url{https://github.com/RanWeisberg/ToS-Guardian}}
}
```
