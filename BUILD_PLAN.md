# BUILD_PLAN.md — ToS Guardian build roadmap

The ordered plan for building the agent. Each phase is scoped to be **one Claude Code
session** (design phases run in Claude Design). A phase is not finished until **both** the
code is correct *and* its verify check passes. Don't start a phase before the previous
one's check is green.

See `CLAUDE.md` for the hard constraints and `PROJECT_SPEC.md` for product detail.

---

## The working loop

1. Instructions + a ready-to-paste prompt (Claude Code or Claude Design) + the phase's
   definition-of-done and a concrete **verify check** are provided.
2. Run it, commit to the repo, update the repo data.
3. Review: the code is read against the DoD; the **verify check output** is confirmed.
4. Green on both → next phase. Otherwise → precise fixes, repeat.

**Two-sided verification.** Code review can catch missing pieces, wrong contracts, broken
interfaces, module-name drift, and budget-wasteful patterns. It **cannot** run the code or
hit the deployed environment. So every phase carries a check *you* run (a test, a curl, a
prod hit) and paste back. "Code correct" + "actually works" must both be true.

---

## Phase 0 — Skeleton + connectivity (no features)
**Goal:** Scaffold the Next.js app, wire env into Vercel, port config to TS, and prove all
four external dependencies round-trip **from the deployed environment**.
**Why here:** De-risks the classic killer — "works local, dies on Vercel" — before any
feature exists.
**DoD / verify:** A throwaway route round-trips LLMod chat, LLMod embed, Pinecone query,
and Supabase read/write, **in production**, not just localhost.

## Phase 1 — Supabase schema + preference seeding
**Goal:** Version store (raw text + clause→case classifications + service/category/version)
and preference table keyed by (case × category), seeded from ToS;DR severity defaults.
**Why here:** Pure infra, no LLM, testable alone; later modules depend on it.
**DoD / verify:** Write a version and read back a **sliced** preference set by (cases, category).

## Phase 2 — Shared primitives + contracts
**Goal:** LLMod client wrapper (chat + embed), Pinecone-query helper, the `Step` tracer,
the frozen module-name constants, and the typed input/output contract for each module.
No business logic.
**Why here:** Every module and the design track depend on these shapes.
**DoD / verify:** A dummy pipeline emits a valid `steps` array and a valid `/api/execute`
envelope. **→ This unblocks the Claude Design track (see below).**

## Phase 3 — The eight modules (one session each, in order)
`IntakeRouter → DocumentResolver → ClauseExtractor → CaseClassifier → VersionDiffer →
MaterialityJudge → ReportComposer → StateWriter`
Each takes typed input, returns typed output, appends its step(s). Give **CaseClassifier**
(the RAG core) the most care and keep its LLM call **batched, not per-clause**.
**DoD / verify (per module):** Runs against a fixed sample agreement and produces the
expected typed output + valid step(s).

## Phase 4 — Orchestrator + `/api/execute`
**Goal:** Wire modules into the two paths (onboarding, monitoring), both through the one
door. The orchestrator is an agent that **decides** (IntakeRouter picks the path,
DocumentResolver fetch-vs-ask, MaterialityJudge report-vs-silence) — a deterministic graph
with LLM-judgment nodes, **not** a ReAct replanning loop (cheaper, demo-reliable; the trace
still shows genuine judgment).
**DoD / verify:** Paste a sample agreement → valid response + full trace, under the ceiling.

## Phase 5 — The other three endpoints
`team_info`, `agent_info` (with worked examples + real step traces), `model_architecture`
(the PNG; names must match the §3 constants). Cheap — one session.
**DoD / verify:** All three return spec-shaped payloads; the PNG's module names match.

## Phase 6 — Mail trigger layer
**Goal:** Gmail poll via Vercel cron + a manual "check mail now" that calls the same core.
Thin adapter in front of `/api/execute`; not part of the LLM trace.
**DoD / verify:** New mail (or the manual button) drives a core run end to end.

## Phase 7 — GUI (implement the frozen design)
**Goal:** Port the approved Claude Design output; wire it to Supabase and the API; hook up
real streaming steps. Four tabs + the report-detail drill-down (the per-point feedback loop
— the thesis; give it space).
**Why here:** By now design is frozen (`DESIGN.md`), so this is a **port**, not a redesign.
**DoD / verify:** Each tab and drill-down works against real data; steps stream live.

## Phase 8 — Seed + demo insurance
**Goal:** Demo user, a few onboarded services, and the artificial-service + changed-version
generator so the monitoring demo fires on command regardless of live-mail timing.
**DoD / verify:** A one-click path produces a fresh change report on demand.

## Phase 9 — Prod parity + budget audit
**Goal:** Confirm every path works in production; tally token spend against $13.
**DoD / verify:** All endpoints + both intake paths green in prod; spend within budget.

---

## Parallel track — Claude Design (runs alongside Phases 3–6)

Design needs only the **contracts**, not a working backend. The moment Phase 2 lands,
open the design track and run it in parallel with the backend phases, then freeze it into
`DESIGN.md` before Phase 7. See `DESIGN.md` for the handoff detail.

- **High-fidelity (earns the care):** the execute + streaming-steps screen (the graded
  bare interface, best demo moment) and the report-detail drill-down (the thesis).
- **Light pass:** dashboard tabs, preferences editor, paste form — conventional; Claude
  Code builds these from the spec with the visual tokens applied.
- **Discipline:** design on **contract-shaped mock data** (real module names, real `steps`
  shape, real report + preference shapes) so Phase 7 is a clean port.
