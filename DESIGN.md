# DESIGN.md — Claude Design handoff

The contract between the **Claude Design** track (look + interaction) and the **Claude
Code** implementation (Phase 7). Claude Design produces a *spec and skeletons*, not the
wired app. Phase 7 ports the frozen result and wires it to Supabase + the API.

**Status:** template. The mock-data stubs below are placeholders — **fill them with the
real contract shapes once Phase 2 lands**, then design against those. Freeze this file
(chosen layouts, component list, tokens, exported skeletons) before starting Phase 7.

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

### 1. Execute + streaming-steps screen (the graded bare interface)
Textarea → **Run Agent** → final `response` → the full `steps` trace (collapsible).
Design the **progressive states** explicitly, since a real run takes several seconds:
`reading → classifying → diffing → composing`. This is the best demo moment.

### 2. Report-detail drill-down (the thesis)
Clause-by-clause: what changed → which ToS;DR case it maps to → severity → **why it
matters to you**. Each point carries a **feedback control** (care / don't care, agree /
disagree) — the per-point loop that trains the preference table. First-class layout.

## Light pass (layout + tokens only, built in Phase 7 from the spec)

Dashboard (pending reports → standing issues → recent activity → subscribed services),
Preferences editor (grouped by the 26 topics, cases nested), Log tab, Add-agreement paste
form. Empty states: greet a fresh deploy with "add your first service," not empty panels.

---

## Visual tokens (fill in during the design track)

- Color: _tbd_
- Type: _tbd_
- Spacing / radius / elevation: _tbd_
- Component inventory: _tbd_

## Contract-shaped mock data (replace with Phase 2 real shapes)

```jsonc
// /api/execute response — fill with the exact Phase 2 shape
{
  "status": "ok",
  "error": null,
  "response": "…",
  "steps": [
    { "module": "IntakeRouter",   "prompt": { "system_prompt": "…", "user_prompt": "…" }, "response": {} },
    { "module": "CaseClassifier", "prompt": { "system_prompt": "…", "user_prompt": "…" }, "response": {} }
  ]
}

// Report detail — fill with the Phase 3 ReportComposer output shape
{
  "service": "…", "category": "…",
  "points": [
    { "change": "…", "case": "…", "severity": "…", "why_it_matters": "…", "feedback": null }
  ]
}

// Preference row — fill with the Phase 1 table shape
{ "case": "…", "category": "…", "stance": "care|dont_care", "source": "default|user" }
```

## Freeze checklist (before Phase 7)

- [ ] Chosen layout for both priority screens
- [ ] Component inventory
- [ ] Tokens (color / type / spacing) finalized
- [ ] Any exported JSX skeletons saved
- [ ] Mock data replaced with real Phase 2 contract shapes
