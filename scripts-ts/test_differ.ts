/**
 * scripts-ts/test_differ.ts — standalone smoke test for Module 5 (VersionDiffer).
 *
 * Three cases:
 *   (a) no prior version        → baseline (hasPrior=false, all "added"), 0 steps.
 *   (b) one case added + one removed, rest identical text → mechanical diff, 0 steps.
 *   (c) same case but reworded clause → one LLM judgment call, at most 1 step.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_differ.ts
 */

import { runVersionDiffer } from "@/lib/modules/versionDiffer";
import { Tracer } from "@/lib/trace";
import type { ClauseCaseClassification, MatchedCase } from "@/lib/contracts";

// --- tiny fixture helpers -------------------------------------------------
function mc(case_id: string, title: string, classification: MatchedCase["classification"], weight: number): MatchedCase {
  return { case_id, title, classification, weight, topic: "Test Topic", confidence: 0.9 };
}
function cc(clause_id: string, clause_text: string, cases: MatchedCase[]): ClauseCaseClassification {
  return { clause_id, clause_text, cases };
}

// Shared building blocks.
const OWNERSHIP = mc("183", "You maintain ownership of your content", "good", 50);
const THIRD_PARTY = mc("166", "This service shares your personal data with third parties that are not essential to its operation", "bad", 70);
const ADS = mc("216", "Your personal data is used for advertising purposes", "bad", 30);

async function run(label: string, current: ClauseCaseClassification[], prior: ClauseCaseClassification[] | null) {
  console.log("\n=====================================================");
  console.log(`CASE: ${label}`);
  console.log("=====================================================");
  const tracer = new Tracer();
  const out = await runVersionDiffer({ current, prior }, tracer);
  console.log(`hasPrior: ${out.hasPrior}`);
  for (const ch of out.changes) {
    console.log(`  [${ch.type}] case ${ch.case_id} — ${ch.summary}`);
  }
  console.log(`steps recorded: ${tracer.steps.length}`);
  if (tracer.steps.length > 0) {
    console.log("  step response:", JSON.stringify(tracer.steps[0].response));
  }
}

async function main() {
  // (a) baseline — no prior.
  await run(
    "(a) no prior → baseline, expect 0 steps",
    [
      cc("c1", "You retain ownership of the content you upload.", [OWNERSHIP]),
      cc("c2", "We may share your usage data with third-party advertising and analytics partners.", [THIRD_PARTY]),
    ],
    null,
  );

  // (b) one bad case ADDED (216 ads), one REMOVED (166 third-party); ownership carried
  //     over with IDENTICAL text → all mechanical, expect 0 steps.
  await run(
    "(b) one added + one removed, rest identical → expect 0 steps",
    [
      cc("c1", "You retain ownership of the content you upload.", [OWNERSHIP]), // unchanged text
      cc("c2", "We now use your personal data to show you targeted advertising.", [ADS]), // ADDED case
    ],
    [
      cc("p1", "You retain ownership of the content you upload.", [OWNERSHIP]), // same text
      cc("p2", "We may share your usage data with third-party advertising and analytics partners.", [THIRD_PARTY]), // REMOVED case
    ],
  );

  // (c) same case (183 ownership) present in both but REWORDED → LLM judgment, ≤1 step.
  await run(
    "(c) reworded-but-equivalent clause → expect at most 1 step",
    [
      cc(
        "c1",
        "You keep full ownership of any content you upload to the service; we claim no ownership over it.",
        [OWNERSHIP],
      ),
    ],
    [
      cc("p1", "You retain ownership of the content you upload.", [OWNERSHIP]),
    ],
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
