/**
 * scripts-ts/test_report.ts — standalone smoke test for Module 7 (ReportComposer).
 *
 * Two scenarios:
 *   (1) material findings present (the bad case-166 finding from the materiality test)
 *       → a structured clause-by-clause report is produced, 1 step.
 *   (2) empty material findings → silent "no report", 0 steps (no LLM call).
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_report.ts
 */

import { runReportComposer } from "@/lib/modules/reportComposer";
import { Tracer } from "@/lib/trace";
import type { MaterialFinding, MatchedCase, DiffChange } from "@/lib/contracts";

function mc(case_id: string, title: string, classification: MatchedCase["classification"], weight: number): MatchedCase {
  return { case_id, title, classification, weight, topic: "Third Parties", confidence: 0.95 };
}

const CASE_166 = mc(
  "166",
  "This service shares your personal data with third parties that are not essential to its operation",
  "bad",
  70,
);

const CHANGE_166: DiffChange = {
  type: "added",
  case_id: "166",
  before: null,
  after: {
    clause_id: "c1",
    clause_text: "We may share your usage data with third-party advertising and analytics partners.",
    cases: [CASE_166],
  },
  summary: "New case: the service now shares your personal data with non-essential third parties.",
};

const FINDING_166: MaterialFinding = {
  case_id: "166",
  classification: "bad",
  weight: 70,
  reason: "The user cares about this issue, and the new non-essential third-party sharing is a bad, high-weight change.",
  change: CHANGE_166,
};

async function scenario1() {
  console.log("\n=====================================================");
  console.log("SCENARIO 1: material findings present → expect a report, 1 step");
  console.log("=====================================================");
  const tracer = new Tracer();
  const out = await runReportComposer(
    { service: "Acme Cloud", category: "cloud storage", mode: "change", material: [FINDING_166] },
    tracer,
  );
  console.log(`silent: ${out.silent}`);
  console.log("\n--- report ---\n");
  console.log(out.report);
  console.log("\n--- recorded step response (structured) ---");
  console.log(JSON.stringify(tracer.steps[0]?.response, null, 2));
  console.log(`\nsteps recorded: ${tracer.steps.length} (expected 1)`);
}

async function scenario2() {
  console.log("\n=====================================================");
  console.log("SCENARIO 2: no material findings → expect silent, 0 steps");
  console.log("=====================================================");
  const tracer = new Tracer();
  const out = await runReportComposer(
    { service: "Acme Cloud", category: "cloud storage", mode: "change", material: [] },
    tracer,
  );
  console.log(`silent: ${out.silent}`);
  console.log(`report: ${out.report}`);
  console.log(`steps recorded: ${tracer.steps.length} (expected 0 — no LLM call when silent)`);
}

async function main() {
  await scenario1();
  await scenario2();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
