/**
 * scripts-ts/test_extractor.ts — standalone smoke test for Module 3 (ClauseExtractor).
 *
 * Runs runClauseExtractor on ONE fixed multi-clause sample that deliberately includes
 * obvious boilerplate (a header + a table-of-contents line + an address) so we can
 * verify those are dropped while the real terms are segmented. Makes ONE real LLM call.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_extractor.ts
 */

import { runClauseExtractor } from "@/lib/modules/clauseExtractor";
import { Tracer } from "@/lib/trace";
import type { ClauseExtractorInput } from "@/lib/contracts";

const SAMPLE: ClauseExtractorInput = {
  service: "Acme Cloud",
  category: "cloud storage",
  text: [
    "ACME CLOUD TERMS OF SERVICE", // boilerplate: header
    "Effective date: January 1, 2026", // boilerplate: effective-date line
    "",
    "Table of Contents: 1. Account  2. Content  3. Data  4. Billing  5. Changes", // boilerplate: TOC
    "",
    "1. Account",
    "You must be at least 16 years old to create an account. You are responsible for",
    "keeping your password confidential and for all activity under your account.",
    "",
    "2. Content",
    "By uploading content you grant Acme Cloud a worldwide, non-exclusive, royalty-free",
    "licence to host, store, and back up your content solely to provide the service.",
    "You retain ownership of the content you upload.",
    "",
    "3. Data",
    "We collect your usage data, device identifiers, and approximate location. We may",
    "share this data with third-party advertising and analytics partners.",
    "",
    "4. Billing",
    "Subscriptions renew automatically each month. You may cancel at any time, but fees",
    "already paid are non-refundable for the current billing period.",
    "",
    "5. Changes",
    "We may modify these terms at any time and will notify you of material changes by",
    "email at least 14 days before they take effect.",
    "",
    "Acme Cloud Inc., 100 Example Street, Springfield. Contact: legal@acme.example", // boilerplate: address/contact
  ].join("\n"),
};

async function main() {
  const tracer = new Tracer();
  try {
    const out = await runClauseExtractor(SAMPLE, tracer);

    console.log("=== extracted clauses ===");
    for (const c of out.clauses) {
      console.log(`\n[${c.id}] ${c.text}`);
    }
    console.log(`\nclauses returned: ${out.clauses.length}`);

    console.log("\n=== recorded step(s) ===");
    console.log(JSON.stringify(tracer.steps, null, 2));
    console.log(`\nsteps recorded: ${tracer.steps.length} (expected exactly 1)`);
  } catch (err) {
    console.error("\n!!! runClauseExtractor threw:");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
