/**
 * scripts-ts/test_statewriter.ts — standalone smoke test for Module 8 (StateWriter).
 *
 * Runs against REAL Supabase (.env.local) using a throwaway service + a throwaway
 * (case_id, category) preference key so nothing real is touched, then CLEANS UP
 * everything it created so the tables are left pristine.
 *
 *   (1) write a baseline version (v0) → expect an id + written=true.
 *   (2) re-run the SAME write → expect written=false, same id, no duplicate.
 *   (3) write a user preferenceUpdate → expect an upsert with source='user'.
 *   (4) cleanup → delete the test rows.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_statewriter.ts
 */

import { runStateWriter } from "@/lib/modules/stateWriter";
import { Tracer } from "@/lib/trace";
import { supabase } from "@/lib/db";
import type { StateWriterInput } from "@/lib/contracts";

const TEST_SERVICE = "ZZZ_TestSvc";
const TEST_PREF_CASE = "ZZZ_TESTCASE"; // not a real ToS;DR case_id
const TEST_PREF_CATEGORY = "ZZZ_TestCategory"; // not a real seeded category

const BASE_INPUT: StateWriterInput = {
  service: TEST_SERVICE,
  category: "test cloud storage",
  version: 0,
  raw_text: "You retain ownership of your content. We may share usage data with partners.",
  classifications: [
    { clause_id: "c1", clause_text: "You retain ownership of your content.", cases: [{ case_id: "183" }] },
    { clause_id: "c2", clause_text: "We may share usage data with partners.", cases: [{ case_id: "166" }] },
  ],
};

async function cleanup() {
  await supabase.from("agreement_versions").delete().eq("service", TEST_SERVICE);
  await supabase
    .from("preferences")
    .delete()
    .eq("case_id", TEST_PREF_CASE)
    .eq("category", TEST_PREF_CATEGORY);
}

async function main() {
  const tracer = new Tracer();

  // Pre-clean in case a prior aborted run left rows behind.
  await cleanup();

  try {
    // (1) baseline write.
    console.log("\n--- (1) baseline write (v0) ---");
    const first = await runStateWriter(BASE_INPUT, tracer);
    console.log("result:", JSON.stringify(first));
    console.log(`steps recorded: ${tracer.steps.length} (expected 0 — mechanical)`);
    if (!(first.written === true && typeof first.versionId === "number")) {
      throw new Error("Expected written=true and a numeric versionId on first write.");
    }

    // (2) idempotent re-run.
    console.log("\n--- (2) idempotent re-run (same v0) ---");
    const second = await runStateWriter(BASE_INPUT, tracer);
    console.log("result:", JSON.stringify(second));
    if (!(second.written === false && second.versionId === first.versionId)) {
      throw new Error("Expected written=false and the same versionId on idempotent re-run.");
    }
    const { count } = await supabase
      .from("agreement_versions")
      .select("id", { count: "exact", head: true })
      .eq("service", TEST_SERVICE);
    console.log(`rows for ${TEST_SERVICE}: ${count} (expected 1 — no duplicate)`);
    if (count !== 1) throw new Error(`Expected exactly 1 row, found ${count}.`);

    // (3) preference update (user override).
    console.log("\n--- (3) user preferenceUpdate ---");
    await runStateWriter(
      {
        ...BASE_INPUT,
        preferenceUpdates: [
          { case_id: TEST_PREF_CASE, category: TEST_PREF_CATEGORY, stance: "care" },
        ],
      },
      tracer,
    );
    const { data: pref, error: prefErr } = await supabase
      .from("preferences")
      .select("case_id, category, stance, source")
      .eq("case_id", TEST_PREF_CASE)
      .eq("category", TEST_PREF_CATEGORY)
      .single();
    if (prefErr) throw new Error(`Could not read back preference: ${prefErr.message}`);
    console.log("preference row:", JSON.stringify(pref));
    if (!(pref.source === "user" && pref.stance === "care")) {
      throw new Error("Expected preference upserted with source='user', stance='care'.");
    }

    console.log(`\ntotal steps recorded across all calls: ${tracer.steps.length} (expected 0)`);
    console.log("\n✅ all StateWriter assertions passed");
  } finally {
    // (4) cleanup — always, even if an assertion failed.
    await cleanup();
    const { count: leftover } = await supabase
      .from("agreement_versions")
      .select("id", { count: "exact", head: true })
      .eq("service", TEST_SERVICE);
    console.log(`\n--- (4) cleanup done — leftover ${TEST_SERVICE} rows: ${leftover} (expected 0) ---`);
  }
}

main().catch((err) => {
  console.error("\n!!! test_statewriter failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
