/**
 * scripts-ts/test_classifier.ts — standalone smoke test for Module 4 (CaseClassifier).
 *
 * Feeds a fixed set of ~4 clauses (reusing a couple from the ClauseExtractor sample) and
 * runs the full RAG path: batched embed → per-clause Pinecone retrieval → ONE batched
 * judgment call. Logs the matched case(s) per clause, then the recorded step + count.
 *
 * Real embed + Pinecone + one chat call, so run with the env file:
 *   npx tsx --env-file=.env.local scripts-ts/test_classifier.ts
 */

import { runCaseClassifier } from "@/lib/modules/caseClassifier";
import { Tracer } from "@/lib/trace";
import type { CaseClassifierInput } from "@/lib/contracts";

const INPUT: CaseClassifierInput = {
  category: "cloud storage",
  clauses: [
    {
      id: "c1",
      text:
        "By uploading content you grant Acme Cloud a worldwide, non-exclusive, royalty-free " +
        "licence to host, store, and back up your content solely to provide the service.",
    },
    {
      id: "c2",
      text: "You retain ownership of the content you upload.",
    },
    {
      id: "c3",
      text: "We may share your usage data with third-party advertising and analytics partners.",
    },
    {
      id: "c4",
      text:
        "We may modify these terms at any time and will notify you of material changes by " +
        "email at least 14 days before they take effect.",
    },
  ],
};

async function main() {
  const tracer = new Tracer();
  try {
    const out = await runCaseClassifier(INPUT, tracer);

    console.log("=== clause → case mappings ===");
    for (const cc of out.classifications) {
      console.log(`\n[${cc.clause_id}] ${cc.clause_text}`);
      if (cc.cases.length === 0) {
        console.log("   → (no case mapped)");
      } else {
        for (const m of cc.cases) {
          console.log(
            `   → case ${m.case_id} "${m.title}" [${m.classification}, weight ${m.weight}, topic ${m.topic}] conf=${m.confidence}`,
          );
        }
      }
    }

    console.log("\n=== recorded step(s) ===");
    console.log(JSON.stringify(tracer.steps, null, 2));
    console.log(`\nsteps recorded: ${tracer.steps.length} (expected exactly 1)`);
  } catch (err) {
    console.error("\n!!! runCaseClassifier threw:");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
