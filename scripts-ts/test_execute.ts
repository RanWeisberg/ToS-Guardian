/**
 * scripts-ts/test_execute.ts — end-to-end smoke test for the orchestrator (Phase 4).
 *
 * Exercises runAgent() (the pure core behind /api/execute) against REAL LLMod.ai +
 * Pinecone + Supabase (.env.local), covering both the short-circuit and the full
 * pipeline branches:
 *
 *   (a) out-of-scope prompt  → short-circuits after IntakeRouter (no further modules,
 *                              nothing persisted).
 *   (b) onboarding paste     → runs the whole pipeline on a throwaway sample service,
 *                              composes a baseline report, persists a v0, and records
 *                              a multi-module steps trace.
 *
 * Cleanup is by SERVICE NAME, not by "id > idBefore": the onboarding prompt names an
 * obviously-throwaway service (the ZZZ_ prefix), and cleanup deletes ALL
 * agreement_versions rows for that test service. That runs BOTH at the start (clearing
 * any residue a prior failed run left behind — which would otherwise make StateWriter's
 * idempotent (service, version) hit return written=false and fail the baseline check)
 * AND in a finally block. The test is therefore self-healing and can't be poisoned by a
 * previous failure. Only ZZZ_-prefixed rows are ever touched — real data is never at risk.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_execute.ts
 */

import { runAgent } from "@/lib/orchestrator";
import { supabase } from "@/lib/db";

const VERSIONS_TABLE = "agreement_versions";

/** The throwaway service this test onboards. The ZZZ_ prefix makes it unmistakably
 *  test-only; cleanup matches on it (case-insensitive prefix) so it never touches real
 *  services, and still catches minor name normalizations from IntakeRouter. */
const TEST_SERVICE = "ZZZ_TestCloud";
/** Case-insensitive prefix pattern for the throwaway service (SQL LIKE). */
const TEST_SERVICE_PATTERN = "ZZZ%";

/** A throwaway agreement (mirrors the Acme fixture's clauses) for the ZZZ_ test service,
 *  wrapped in an onboarding framing so IntakeRouter classifies it as an inline paste and
 *  extracts the ZZZ_TestCloud service name verbatim. */
const TEST_TERMS = [
  `${TEST_SERVICE} TERMS OF SERVICE`,
  "Effective date: January 1, 2026",
  "",
  "Table of Contents: 1. Account  2. Content  3. Data  4. Billing  5. Changes",
  "",
  "1. Account",
  "You must be at least 16 years old to create an account. You are responsible for",
  "keeping your password confidential and for all activity under your account.",
  "",
  "2. Content",
  `By uploading content you grant ${TEST_SERVICE} a worldwide, non-exclusive, royalty-free`,
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
  `${TEST_SERVICE} Inc., 100 Example Street, Springfield. Contact: legal@zzz.example`,
].join("\n");

const ONBOARDING_PROMPT = [
  `I'm signing up for ${TEST_SERVICE}, a cloud storage service, and I'm being asked to`,
  `accept these terms. The service is named "${TEST_SERVICE}". What am I agreeing to?`,
  "",
  TEST_TERMS,
].join("\n");

const OUT_OF_SCOPE_PROMPT =
  "Hey, can you recommend a good pasta recipe for dinner tonight? Nothing fancy.";

/** Delete ALL version-store rows for the throwaway test service (idempotent, self-healing).
 *  Returns how many rows were removed. Never matches non-test services. */
async function cleanupTestService(): Promise<number> {
  const { data, error } = await supabase
    .from(VERSIONS_TABLE)
    .delete()
    .ilike("service", TEST_SERVICE_PATTERN)
    .select("id");
  if (error) throw new Error(`cleanup failed: ${error.message}`);
  return (data ?? []).length;
}

/** Count current version-store rows for the throwaway test service. */
async function testServiceRowCount(): Promise<number> {
  const { count, error } = await supabase
    .from(VERSIONS_TABLE)
    .select("id", { count: "exact", head: true })
    .ilike("service", TEST_SERVICE_PATTERN);
  if (error) throw new Error(`could not count test-service rows: ${error.message}`);
  return count ?? 0;
}

function logResult(label: string, response: string, steps: { module: string }[]): void {
  const names = steps.map((s) => s.module);
  console.log(`\n=== ${label} ===`);
  console.log("step modules (in order):", names.join(" → ") || "(none)");
  console.log("total steps:", steps.length);
  console.log("response:\n" + response);
}

async function main() {
  // ---- Pre-clean: clear any residue from a prior (possibly failed) run. ----
  const preCleaned = await cleanupTestService();
  console.log(
    `--- pre-clean: removed ${preCleaned} stale ${TEST_SERVICE} row(s) before the run ---`,
  );

  try {
    // ---- (a) out-of-scope: must short-circuit after IntakeRouter. ---------
    const oos = await runAgent(OUT_OF_SCOPE_PROMPT);
    logResult("(a) out-of-scope", oos.response, oos.steps);

    const oosModules = oos.steps.map((s) => s.module);
    if (oosModules.length !== 1 || oosModules[0] !== "IntakeRouter") {
      throw new Error(
        `Expected out-of-scope to record exactly one IntakeRouter step, got: [${oosModules.join(", ")}]`,
      );
    }

    // It must not have persisted anything for the test service.
    if ((await testServiceRowCount()) !== 0) {
      throw new Error("Out-of-scope path unexpectedly wrote to the version store.");
    }

    // ---- (b) onboarding paste: full pipeline, baseline v0 persisted. ------
    const full = await runAgent(ONBOARDING_PROMPT);
    logResult(`(b) onboarding (${TEST_SERVICE})`, full.response, full.steps);

    const fullModules = full.steps.map((s) => s.module);

    // The three always-LLM modules must run, in order, at the front of the trace.
    const requiredPrefix = ["IntakeRouter", "ClauseExtractor", "CaseClassifier"];
    for (let i = 0; i < requiredPrefix.length; i++) {
      if (fullModules[i] !== requiredPrefix[i]) {
        throw new Error(
          `Expected step ${i} to be ${requiredPrefix[i]}, got ${fullModules[i]}. Full trace: [${fullModules.join(", ")}]`,
        );
      }
    }
    if (fullModules.length < 3) {
      throw new Error(`Expected a multi-module trace, got only ${fullModules.length} step(s).`);
    }

    // A baseline v0 must have been persisted for the test service.
    const { data: written, error: readErr } = await supabase
      .from(VERSIONS_TABLE)
      .select("id, service, category, version, active")
      .ilike("service", TEST_SERVICE_PATTERN);
    if (readErr) throw new Error(`could not read back written rows: ${readErr.message}`);

    console.log("\n=== persisted rows (this run) ===");
    console.log(JSON.stringify(written, null, 2));

    const baseline = (written ?? []).find((r) => r.version === 0);
    if (!baseline) {
      throw new Error("Expected a baseline v0 row to be persisted by the onboarding run.");
    }
    if (baseline.active !== true) {
      throw new Error("Expected the baseline row to be active.");
    }

    // Report vs silent is LLM-dependent; report which happened rather than hard-fail.
    const composedReport = !full.response.startsWith("I recorded ");
    console.log(
      composedReport
        ? "\n✓ ReportComposer produced a baseline report."
        : "\n(note) baseline was silent — no material findings; baseline summary returned.",
    );

    console.log("\n✅ all runAgent assertions passed");
  } finally {
    // ---- cleanup: always, even on assertion failure (delete by service). --
    const removed = await cleanupTestService();
    console.log(
      `\n--- cleanup done — removed ${removed} ${TEST_SERVICE} row(s); remaining: ${await testServiceRowCount()} (expected 0) ---`,
    );
  }
}

main().catch((err) => {
  console.error("\n!!! test_execute failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});