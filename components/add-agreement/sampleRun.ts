/**
 * components/add-agreement/sampleRun.ts
 *
 * Realistic placeholder data for <AddAgreement />. The trace is real `Step[]`
 * (lib/trace.ts) — each step carries its true frozen module name and a `response`
 * shaped exactly like the corresponding module output (lib/contracts.ts): so the
 * friendly labels/descriptions the screen renders are derived from real fields,
 * never invented ones. Only the five LLM modules appear in the trace (CLAUDE.md
 * §3), matching the design's five steps.
 *
 * Placeholder only — replaced by live /api/execute output when wired later.
 */

import type { Step } from "@/lib/trace";
import { MODULES } from "@/lib/modules";
import type { AddAgreementProps } from "./AddAgreement";

const steps: Step[] = [
  {
    module: MODULES.IntakeRouter,
    prompt: {
      system_prompt: "Classify the input and extract service + category.",
      user_prompt: "Review this Acme Cloud agreement: …",
    },
    // IntakeRouterOutput
    response: {
      kind: "onboarding",
      service: "Acme Cloud",
      category: "cloud storage",
      source: "inline",
      inline_text: "You grant Acme a worldwide, non-exclusive licence …",
      link_url: null,
    },
  },
  {
    module: MODULES.ClauseExtractor,
    prompt: {
      system_prompt: "Segment the agreement into meaningful clauses.",
      user_prompt: "Text: You grant Acme a worldwide licence …",
    },
    // Clause[]
    response: [
      { id: "c1", text: "You grant Acme a worldwide, non-exclusive licence to host your content." },
      { id: "c2", text: "We may share certain personal information with advertising partners." },
      { id: "c3", text: "Acme may modify these terms at any time; continued use is acceptance." },
    ],
  },
  {
    module: MODULES.CaseClassifier,
    prompt: {
      system_prompt: "Map each clause to the nearest ToS;DR case(s).",
      user_prompt: "Clauses: [c1, c2, c3]",
    },
    // ClauseCaseClassification[]
    response: [
      {
        clause_id: "c1",
        clause_text: "You grant Acme a worldwide, non-exclusive licence to host your content.",
        cases: [
          {
            case_id: "content-license-granted",
            title: "Content licence granted to the service",
            classification: "neutral",
            weight: 40,
            topic: "Ownership",
            confidence: 0.88,
          },
        ],
      },
      {
        clause_id: "c2",
        clause_text: "We may share certain personal information with advertising partners.",
        cases: [
          {
            case_id: "data-shared-advertising",
            title: "Personal data shared with third parties for advertising",
            classification: "bad",
            weight: 75,
            topic: "Data Collection",
            confidence: 0.91,
          },
        ],
      },
      {
        clause_id: "c3",
        clause_text: "Acme may modify these terms at any time; continued use is acceptance.",
        cases: [
          {
            case_id: "unilateral-terms-change",
            title: "Terms can be changed unilaterally at any time",
            classification: "bad",
            weight: 70,
            topic: "Changes to Terms",
            confidence: 0.86,
          },
        ],
      },
    ],
  },
  {
    module: MODULES.MaterialityJudge,
    prompt: {
      system_prompt: "Judge which findings are material given the user's preferences.",
      user_prompt: "Findings + preference slice …",
    },
    // MaterialityJudge verdict ({ hasMaterialFindings, items[] })
    response: {
      hasMaterialFindings: true,
      items: [
        { itemId: "content-license-granted", material: true, reason: "Affects who can use your files." },
        { itemId: "data-shared-advertising", material: true, reason: "You told us you care about ad-sharing." },
        { itemId: "unilateral-terms-change", material: true, reason: "Terms can shift without notice." },
      ],
    },
  },
  {
    module: MODULES.ReportComposer,
    prompt: {
      system_prompt: "Write the personalized, plain-language report.",
      user_prompt: "Material findings for Acme Cloud …",
    },
    // ReportComposer parsed output
    response: {
      intro: "Here's what agreeing to Acme Cloud means",
      points: 3,
    },
  },
];

export const sampleRun: AddAgreementProps = {
  steps,
  serviceValue: "Acme Cloud",
  agreementValue:
    "You grant Acme a worldwide, non-exclusive licence to host, store, reproduce, and process content you upload…",
  done: true,
};
