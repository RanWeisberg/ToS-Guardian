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
- **Learns your preferences.** Your answers to a report are remembered, so the agent gets
  better at judging what's material to *you* over time.
- **Tracks your services** and re-flags standing issues when your preferences change —
  without re-running the language model.
- **Monitors your inbox** (optional) for terms-change emails and reviews them on demand.

> ToS Guardian is not legal advice and is not a substitute for a lawyer. It reviews the
> text you give it and flags concerns based on the ToS;DR taxonomy.

## Architecture

ToS Guardian is a **deterministic orchestration graph with LLM-judgment nodes** — not a
free-form agent loop. Two intake paths feed one shared core:

- **Manual path:** the web UI (*Add agreement*) → `POST /api/execute`
- **Monitoring path:** the *Check mail* button → a free inbox peek → `/api/mail_check`

Both converge on **`runAgent`**, which runs five reasoning modules in a fixed order —
these five make up the `steps` trace returned by `/api/execute`:

1. **IntakeRouter** — classifies the request (new agreement vs. change notice) and infers
   the service and its category.
2. **ClauseExtractor** — splits the agreement into individual clauses.
3. **CaseClassifier** — the RAG core: embeds each clause and matches it against the
   ToS;DR case taxonomy stored in Pinecone.
4. **MaterialityJudge** — weighs each matched case against the user's answer history,
   using the ToS;DR taxonomy as an always-on base layer and letting the LLM resolve
   conflicts. Decides what is genuinely material.
5. **ReportComposer** — writes the plain-language report of what matters.

A separate **StateWriter** persists the agreement version and keeps the subscription list
current. It runs as part of a review but is *infrastructure* — it is not one of the five
trace steps.

**Memory & stores:**
- **Pinecone** — the ToS;DR case taxonomy (236 cases): the agent's knowledge base.
- **Supabase** — the version store (`agreement_versions`, which also drives the
  subscription list), reports, and the **answer log** (`answers`) that records what the
  user has been shown and how they responded, keyed per service × case × category.
- **LLMod** — `gpt-5.4-mini` for reasoning and `text-embedding-3-small` for retrieval.
- **Gmail** (read-only, optional) — the monitored mailbox for change notices.

The full architecture diagram is served live at **`/api/model_architecture`**.

## API

Four endpoints back the app:

- `POST /api/execute` — runs the agent on a prompt; returns `{ status, error, response, steps }`.
- `GET /api/agent_info` — the agent's description, purpose, prompt template, and a worked
  example with its full step trace.
- `GET /api/team_info` — the team behind the project.
- `GET /api/model_architecture` — the architecture diagram.

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
