/**
 * scripts-ts/test_report.ts — standalone smoke test for Module 7 (ReportComposer).
 *
 * Three scenarios:
 *   (1) material findings present (the bad case-166 finding from the materiality test)
 *       → structured per-finding `points` are produced, 1 step, NO Markdown blob,
 *         truncation_notice null.
 *   (2) empty material findings → silent, 0 steps (no LLM call), no points.
 *   (3) material findings + truncated=true → points produced AND a non-null
 *       truncation_notice.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_report.ts
 */

import { runReportComposer } from "@/lib/modules/reportComposer";
import { Tracer } from "@/lib/trace";
import type { MaterialFinding, MatchedCase, DiffChange } from "@/lib/contracts";

let failures = 0;
function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

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
  console.log("SCENARIO 1: material findings present → expect structured points, 1 step");
  console.log("=====================================================");
  const tracer = new Tracer();
  const out = await runReportComposer(
    {
      service: "Acme Cloud",
      category: "cloud storage",
      mode: "change",
      material: [FINDING_166],
      truncated: false,
    },
    tracer,
  );
  console.log(`silent: ${out.silent}`);
  console.log(`truncation_notice: ${out.truncation_notice}`);
  console.log("\n--- points (structured) ---\n");
  console.log(JSON.stringify(out.points, null, 2));
  console.log(`\nsteps recorded: ${tracer.steps.length} (expected 1)`);

  const p = out.points[0];
  assert(out.silent === false, "not silent");
  assert(out.truncation_notice === null, "truncation_notice is null when not truncated");
  assert(out.points.length === 1, "one point per finding");
  assert(p?.case_id === "166", "point carries authoritative case_id");
  assert(p?.classification === "bad", "point carries authoritative classification");
  assert(typeof p?.what_it_is === "string" && p.what_it_is.length > 0, "what_it_is present");
  assert(typeof p?.why_it_matters === "string" && p.why_it_matters.length > 0, "why_it_matters present");
  // No Markdown blob anywhere in the output.
  assert(!JSON.stringify(out).includes("#"), "no Markdown headings in output");
  assert(tracer.steps.length === 1, "exactly one LLM step recorded");
}

async function scenario2() {
  console.log("\n=====================================================");
  console.log("SCENARIO 2: no material findings → expect silent, 0 steps");
  console.log("=====================================================");
  const tracer = new Tracer();
  const out = await runReportComposer(
    {
      service: "Acme Cloud",
      category: "cloud storage",
      mode: "change",
      material: [],
      truncated: false,
    },
    tracer,
  );
  console.log(`silent: ${out.silent}`);
  console.log(`points: ${out.points.length}`);
  console.log(`steps recorded: ${tracer.steps.length} (expected 0 — no LLM call when silent)`);

  assert(out.silent === true, "silent when no findings");
  assert(out.points.length === 0, "no points when silent");
  assert(tracer.steps.length === 0, "no LLM step when silent");
}

async function scenario3() {
  console.log("\n=====================================================");
  console.log("SCENARIO 3: findings + truncated=true → expect a truncation_notice");
  console.log("=====================================================");
  const tracer = new Tracer();
  const out = await runReportComposer(
    {
      service: "Acme Cloud",
      category: "cloud storage",
      mode: "onboarding",
      material: [FINDING_166],
      truncated: true,
    },
    tracer,
  );
  console.log(`silent: ${out.silent}`);
  console.log(`truncation_notice: ${out.truncation_notice}`);
  console.log(`points: ${out.points.length}`);

  assert(out.silent === false, "not silent");
  assert(
    typeof out.truncation_notice === "string" && out.truncation_notice.length > 0,
    "truncation_notice present when truncated",
  );
  assert(out.points.length === 1, "points still produced when truncated");
}

async function main() {
  await scenario1();
  await scenario2();
  await scenario3();
  console.log("\n=====================================================");
  if (failures === 0) console.log("ALL CHECKS PASSED");
  else {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
