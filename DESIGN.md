# DESIGN.md — Claude Design handoff

The contract between the **Claude Design** track (look + interaction) and the **Claude
Code** implementation (Phase 7). Claude Design produces a *spec and skeletons*, not the
wired app. Phase 7 ports the frozen result and wires it to Supabase + the API.

**Status: design landed (two priority screens built as components).** The mock-data stubs
below have been replaced with the real Phase 2 contract shapes, and the two priority screens
are built as presentational components:

- `components/add-agreement/AddAgreement.tsx` (+ `.module.css`, `sampleRun.ts`)
- `components/report-detail/ReportDetail.tsx` (+ `.module.css`, `sampleReport.ts`)

Both are presentational, typed to the real backend contracts (`lib/contracts.ts`,
`lib/trace.ts`, `lib/db.ts`), and use realistic placeholder data. They are **not yet wired**
to live data, `/api/execute`, or the feedback-writing path, and there is **no app
shell/layout or routing yet**. This file is frozen: the chosen layouts, component list,
tokens, and decisions below are the standing design contract for Phase 7.

See `PROJECT_SPEC.md` §7 for the full GUI intent and `CLAUDE.md` §3–4 for frozen names and
the trace shape.

---

## How this track runs

- **Parallel to Phases 3–6.** Design needs only contracts, so it overlaps the backend
  build. By the time the backend is done, design is approved and Phase 7 is a port.
- **Design on contract-shaped mock data.** Use the real module names, the real `steps`
  array shape, the real report structure, and preferences grouped by the 26 ToS;DR topics
  — never invented field names, never a flat 236-row list.
- **Freeze the outcome here** the way `CLAUDE.md` freezes build conventions.

## Two priority screens (high fidelity)

### 1. Execute + streaming-steps screen (the graded bare interface) — ✅ BUILT
`components/add-agreement/AddAgreement.tsx`. Textarea → **Review it for me** → the full
`steps` trace as an ordered, friendly step list. Designed for the **progressive states** a
real (several-second) run moves through: `reading → classifying → diffing → composing`. This
is the best demo moment. Trace is driven by the real `Step[]` shape; streaming is deferred to
the wiring step.

### 2. Report-detail drill-down (the thesis) — ✅ BUILT
`components/report-detail/ReportDetail.tsx`. Clause-by-clause: what changed → which ToS;DR
case it maps to → severity → **why it matters to you**. Each point carries a **feedback
control** (care / don't care) — the per-point loop that trains the preference table.
First-class layout.

## Light pass (layout + tokens only, built in Phase 7 from the spec)

Dashboard (pending reports → standing issues → recent activity → subscribed services),
Preferences editor (grouped by the 26 topics, cases nested), Log tab, Add-agreement paste
form. Empty states: greet a fresh deploy with "add your first service," not empty panels.

---

## Visual language (frozen)

- Apple-like, clean, warm — **light theme, not dark**.
- Background: warm off-white `#faf9f7`. Text: near-black (`#1b1b1a` / as ported).
- Accent: warm teal `#0f9e8f` (primary actions, active nav tab, key highlights), used
  sparingly.
- Typography: **Manrope**, large and friendly, strong hierarchy, generous whitespace.
- Cards: full-width, large corner radius (~20px), soft diffuse shadows, minimal hard borders.
- Severity tags: soft amber "Worth noting" (lower) → stronger red "Important" (higher),
  derived from the finding's `classification`.

## Layout rule (frozen, user-specified)

Single vertical column. No two **different** elements share the same horizontal row / bar —
elements stack top to bottom. Exception: tightly-related fields within one group may sit side
by side inside a single card (e.g. the old Service/Category pair). Different cards never sit
side by side.

## Key product/UX decisions (frozen)

- **Category is NOT entered by the user** — the agent infers it (IntakeRouter). The input
  screen has only a paste textarea + a single "Service" field.
- User-facing screens use **FRIENDLY step labels**; the real frozen module names remain in
  the data (`step.module`) and the graded trace view. The friendly mapping is:

  | Real module (frozen, CLAUDE.md §3) | Friendly label |
  |---|---|
  | IntakeRouter | "Understanding your request" |
  | ClauseExtractor | "Reading the fine print" |
  | CaseClassifier | "Matching known issues" |
  | MaterialityJudge | "Deciding what matters to you" |
  | ReportComposer | "Writing your summary" |

  (Mechanical modules are mapped too so the lookup is total; only the 5 LLM modules show in
  the trace, matching the 5-step design.)
- **Report detail:** per-finding feedback ("This matters to me" / "I don't mind this") maps
  to the real `Preference` stance vocabulary (`care | dont_care`) and will write back via
  StateWriter as a `PreferenceUpdate` (not yet wired).

## Four-tab app shell (to build in Phase 7)

Top bar: "ToS Guardian" wordmark + "Ready" pill. Tabs: Dashboard / Preferences / Activity
Log / Add agreement. "Add agreement" is the execute+trace screen (the graded bare
interface). Dashboard, Preferences, Activity Log are light-pass, built from
`PROJECT_SPEC.md` §7.

## Known follow-ups (flagged during handoff)

- `MaterialFinding` has no dedicated friendly per-point title; `ReportDetail` currently uses
  `change.summary` as the headline. If ReportComposer later emits a distinct friendly title,
  repoint that one field.

---

## Real contract shapes (frozen — replaces the earlier mock stubs)

The screens are typed against the real backend contracts; the placeholder data lives in the
sample files and matches these shapes exactly (no invented field names).

- **Execute response / trace** — `ExecuteResponse` + `Step[]` (`lib/contracts.ts`,
  `lib/trace.ts`). Each `Step` is `{ module: ModuleName, prompt: { system_prompt, user_prompt },
  response }`. Placeholder: `components/add-agreement/sampleRun.ts`.
- **Report detail** — `MaterialFinding[]` (`lib/contracts.ts`), rendered with friendly,
  user-facing copy. Placeholder: `components/report-detail/sampleReport.ts`.
- **Preference row** — `Preference` (`lib/db.ts`): `{ case_id, category, stance: "care" |
  "dont_care", source: "default" | "user", … }`.

## Freeze checklist (before Phase 7)

- [x] Chosen layout for both priority screens
- [x] Component inventory
- [x] Tokens (color / type / spacing) finalized
- [x] Any exported JSX skeletons saved (built as real components, not skeletons)
- [x] Mock data replaced with real Phase 2 contract shapes