# ToS Guardian — Project Reference

> Canonical spec for the agent. Update this as decisions land so the build stays organized.
> Last updated during build of the knowledge-base layer.

---

## 1. What it is

An AI agent that reads the terms-of-service and privacy policies a person would never
actually read, maps their clauses onto ToS;DR's taxonomy of known patterns, works out
what **materially changed** from the version the user previously accepted, and tells them
whether they should care — weighted by what that specific user cares about. It reads the
user's mail autonomously and acts only when something meaningful changed.

**One-line purpose:** turn the unread legal fine print of the services you use into
personalized, change-aware alerts.

---

## 2. Deployment model (settled)

- **One hosted web service on Vercel.** Serverless, stateless per call. No installs, no
  daemon. The user (and the graders) open a URL.
- **`POST /api/execute` is the single core.** Text prompt in → `{status, error, response,
  steps}` out. Everything the agent does runs through this one door.
- **All cross-call state lives in external stores** (Supabase, Pinecone) — never on the
  serverless filesystem, which is wiped between calls.
- **5-minute hard ceiling** per call (Vercel limit). An `/api/execute` run must finish
  well under that.

---

## 3. How input reaches the agent (two intake paths, one core)

The two paths differ only in *source*; both feed the same eight-module core.

1. **Onboarding (paste).** The user pastes an agreement and names the service + category.
   This is for the agreement you accept *at signup*, which never arrives as an email.
   The agent explains the consequences of agreeing and stores it as **baseline v0**.
   *This path is also the graded bare interface (see GUI §7).*

2. **Monitoring (mail-triggered).** A change-notification email arrives in the demo
   mailbox. A thin trigger layer extracts the relevant content and calls the same core,
   which detects it's a change notice, resolves the linked policy, diffs it against the
   stored version, and reports only if something material changed.

**Trigger layer (infrastructure, not part of the LLM steps trace):** a Vercel **cron**
function polls the demo Gmail every N minutes and calls the core for new mail. A manual
**"check mail now"** button does the same on demand (demo-safe — never wait on a timer in
front of an audience). Cron is chosen over a push webhook for demo reliability.

---

## 4. Core pipeline (the eight modules)

These names must stay **identical** across the architecture PNG, the `steps` trace, and
every description — it's a grading requirement. This is the locked vocabulary.

| # | Module | Does | LLM? |
|---|--------|------|------|
| 1 | **IntakeRouter** | Classifies the input (onboarding / change-notice / out-of-scope), extracts service + category, detects whether the agreement is inline or linked. | Yes |
| 2 | **DocumentResolver** | If the agreement is linked rather than pasted, fetches the real policy text. Falls back to asking the user to paste when a link is unreachable (login-walled, etc.). | Mostly mechanical; LLM only to disambiguate links |
| 3 | **ClauseExtractor** | Segments the agreement into meaningful clauses, dropping boilerplate. | Yes |
| 4 | **CaseClassifier** | Embeds each clause, queries Pinecone for nearest ToS;DR cases, decides which case(s) it maps to with classification + weight. **The RAG core.** | Embedding + LLM judgment |
| 5 | **VersionDiffer** | Compares the newly classified agreement against the stored prior version to isolate genuine changes vs restated terms. | Mechanical where possible, LLM for judgment |
| 6 | **MaterialityJudge** | Weighs changes (or onboarding findings) against the user's preference slice + case weights to decide what's worth surfacing. | Yes |
| 7 | **ReportComposer** | Produces the personalized report — or stays silent if nothing is material. | Yes |
| 8 | **StateWriter** | Persists the new agreement version, the clause→case classifications, and any preference updates from feedback. | Mechanical |

**Autonomy story ("agent, not pipeline"):** rests on the genuine-judgment steps —
routing, classification, diff, materiality — each a documented decision the agent makes
rather than a fixed transform. The steps trace is where a grader literally sees this.

**Efficiency (graded):** not every module is an LLM call; the preference table is sliced
before injection; classification is batched. This directly serves the "avoid unnecessary
LLM calls / minimize context" criterion and the $13 budget.

---

## 5. Memory (three stores)

- **ToS;DR case taxonomy → Pinecone.** ✅ **DONE.** 236 cases embedded, each with
  title, description, classification (good/neutral/bad/blocker), weight, topic. Retrieval:
  embed a clause → nearest cases. Built with `text-embedding-3-small`.
- **Agreement version store → Supabase.** ⏳ Pending. The reliable diff baseline (ToS;DR's
  own version history is not dependable). Seeded by onboarding; appended on each change.
  **Also stores the clause→case classifications**, not just raw text — so the dashboard can
  re-flag standing issues when preferences change *without re-running the classifier*.
- **Preference table → Supabase.** ⏳ Pending. Keyed by **(case × service category)**.
  Only a filtered relevant slice is injected into prompts. Fallback hierarchy:
  exact case-category match → general case stance → ToS;DR severity default.

---

## 6. Required API surface (project spec)

- `POST /api/execute` — main entry; returns `response` + full `steps` trace.
- `GET /api/team_info` — group batch/order number, team name, members.
- `GET /api/agent_info` — description, purpose, prompt template, worked examples **with
  step traces**.
- `GET /api/model_architecture` — the architecture **PNG** (module names must match §4).
- **GUI at root `/`** — no auth, immediately available.

---

## 7. GUI

**Single user, no login.** The demo runs on one seeded demo user backed by the demo
mailbox — so the dashboard is genuinely populated, not empty. All views read/write that
one user's Supabase state.

**Tabs (top of page):**

### Tab 1 — Dashboard
Ordered by how a person triages (act → be aware → review → inventory):
1. **Pending reports** — change reports awaiting the user's response. The primary action.
2. **Standing issues** — services the user is still subscribed to that carry problematic
   clauses *per the user's preferences*. Recomputed instantly when preferences change
   (cheap: preferences applied to stored classifications, no new LLM calls).
3. **Recent activity** — a short snippet of the agent's latest actions (full history lives
   in the Log tab).
4. **Subscribed services** — the distinct services in the version store (see §8).

### Tab 2 — Preferences
The preference table, presented **grouped by the 26 ToS;DR topics** (Data Collection,
Ownership, Account Termination, …) with cases nested under each — a flat 236-row table is
unusable. Sensible defaults from ToS;DR severity; user overrides on top. Editable here.

### Tab 3 — Log
Full, filterable history: every agreement the agent read, when, and what it did
(nothing / reported), with links into the relevant report or service.

### Tab 4 — Add agreement (paste)
**Doubles as the graded bare interface.** A textarea + "Run Agent" button that calls
`/api/execute`, shows the friendly "here's what agreeing means" output, **and** the full
module-by-module `steps` trace (collapsible). This is the onboarding path for signup-time
agreements. Satisfies the project's minimal-GUI requirement without a throwaway page.

**Drill-down views (beneath the tabs):**

- **Report detail** — *where the whole thesis lives.* Opens a pending report clause-by-clause:
  what changed, which ToS;DR case it maps to, severity, and **why it matters to you**. Each
  point carries a **feedback control** (care / don't care, agree / disagree) — this is the
  per-point loop that trains the preference table. Give it first-class space.
- **Service drill-down** — click a service → its agreement version history, current grade,
  and standing issues. This is where the version store visibly pays off.

**Cross-cutting UX:**
- **Empty states** — a fresh deploy has no data; greet new users with "add your first
  service," not four empty panels. (Seeding the demo user largely handles this.)
- **Stream the steps** on the paste/execute screen ("reading… classifying… diffing…") —
  an `/api/execute` run takes real seconds across several LLM calls, and watching the agent
  think is the best demo-day moment.

---

## 8. Subscribed-services logic

- **The archive *is* the subscription list.** Subscribed services = distinct services in
  the version store. No separate tracking needed.
- **"No longer registered" button → soft-flag, don't delete.** Mark inactive but keep all
  stored versions (retain history; preserve the diff baseline).
- **Re-add rule:** a new-terms email for an inactive service flips it back to active and
  appends the new version. Rationale: a change to something you *were* on is often exactly
  when you'd want to be told.

---

## 9. Demo plan

- **Now:** create the demo mailbox and **sign up to real services** with it, adding each
  via onboarding so the archive/dashboard is populated.
- **Ideal:** real services email real terms updates → the autonomous monitoring path fires
  live.
- **Fallback (build this too):** if real updates don't arrive in time, create one or more
  **artificial services with generated agreements**, then generate a changed version to
  drive the change-detection + report flow on demand.
- **Demo-day insurance:** pre-seed the mailbox and archive so the dashboard is already
  rich; keep the manual "check now" and paste paths as reliable fallbacks so the demo never
  depends on live mail timing, OAuth token freshness, or delivery lag.

---

## 10. Constraints

- **Models (LLMod.ai):** `MB5R2CF-azure/gpt-5.4-mini` (text), `MB5R2CF-azure/text-embedding-3-small`
  (embeddings). Shared group key.
- **Budget:** $13 total. Efficiency is explicitly graded.
- **Knowledge-base cap:** 50 MB (currently ~0.09 MB).
- **Deadline:** 23/8/2026.
- **Stores:** Supabase (primary), Pinecone (vectors).

---

## 11. Shelved (deliberate, revisitable)

- **The Detective** — vague-clause investigation (e.g. "shares with affiliates" → who are
  the affiliates and what's the second-order risk). Gated + modular by design, so it drops
  back in later without touching the core.

---

## 12. Status & open decisions

**Done:** config/secrets layer, taxonomy fetch (236 cases, topics resolved), Pinecone
embedding.

**Next (the hard part):** the eight-module core, the Supabase stores (version store +
preference table), the mail trigger layer, the API endpoints, the GUI, Vercel deploy.

**Open decision — blocking the core:** **Python or Node for the deployed app?** Both work.
Leaning **Next.js / TypeScript**: GUI + API routes in one project, first-class Vercel
support, easy cron for the mail trigger. (The Python ingestion scripts are standalone
one-offs and don't bind this choice.) *Confirm before writing the core so the trigger
layer, endpoints, and GUI are one stack.*

**Also to lock:** the module names in §4 (baked into the diagram + trace), and the
architecture diagram variant for `GET /api/model_architecture`.
