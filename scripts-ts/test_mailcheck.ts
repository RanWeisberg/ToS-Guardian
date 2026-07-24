/**
 * scripts-ts/test_mailcheck.ts — Phase 6a smoke test for the mail-trigger layer.
 *
 * Runs against REAL Supabase (.env.local) and the REAL core (runAgent → LLM), so
 * it consumes a little budget. It uses a throwaway ZZZ_-prefixed service so
 * nothing real is touched, and CLEANS UP everything it created (mock_inbox rows,
 * agreement_versions, AND the reports + answer rows the mail path now persists).
 *
 *   (1) insert 2 mock change-notice rows into mock_inbox.
 *   (2) runMailCheck(mockSource) → expect checked=2, processed=2, each fed
 *       through runAgent (a non-empty "processed" note); AND assert the mail path
 *       persisted a report (source='mail') + answer rows for the service.
 *   (3) RE-RUN runMailCheck(mockSource) → expect checked=0, processed=0
 *       (dedup / idempotency — the rows are now processed=true).
 *   (4) cleanup → delete all ZZZ_ mock_inbox rows + ZZZ_ agreement_versions +
 *       ZZZ_ reports + ZZZ_ answers.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_mailcheck.ts
 */

import { runMailCheck } from "@/lib/mail/trigger";
import { mockSource } from "@/lib/mail/mockSource";
import { supabase } from "@/lib/db";

const SERVICE = "ZZZ_MailSvc"; // throwaway service_hint (also the version-store key)
const ID_1 = "ZZZ_mail_001";
const ID_2 = "ZZZ_mail_002";

const ROWS = [
  {
    id: ID_1,
    service_hint: SERVICE,
    subject: `${SERVICE} has updated its Terms of Service`,
    body:
      "We're writing to let you know we've updated our Terms of Service. " +
      "Effective next month, we may share your usage data with third-party " +
      "advertising partners, and we now retain your content for up to 3 years " +
      "after account closure. By continuing to use the service you accept the " +
      "revised terms.",
  },
  {
    id: ID_2,
    service_hint: SERVICE,
    subject: `Changes to the ${SERVICE} Privacy Policy`,
    body:
      "Our Privacy Policy is changing. We have added a mandatory arbitration " +
      "clause and a class-action waiver. We will also begin using your data to " +
      "train machine-learning models unless you opt out in your settings.",
  },
];

async function cleanup() {
  await supabase.from("mock_inbox").delete().like("id", "ZZZ_%");
  await supabase.from("agreement_versions").delete().eq("service", SERVICE);
  await supabase.from("reports").delete().eq("service", SERVICE);
  await supabase.from("answers").delete().eq("service", SERVICE);
}

async function main() {
  // Pre-clean in case a prior aborted run left rows behind.
  await cleanup();

  try {
    // (1) seed the mock inbox.
    console.log("\n--- (1) insert 2 mock change-notice rows ---");
    const { error: insErr } = await supabase.from("mock_inbox").insert(ROWS);
    if (insErr) throw new Error(`Could not seed mock_inbox: ${insErr.message}`);
    console.log(`inserted: ${ID_1}, ${ID_2}`);

    // (2) first check — both should be processed through runAgent.
    console.log("\n--- (2) runMailCheck (first pass) ---");
    const first = await runMailCheck(mockSource);
    console.log("summary:", JSON.stringify(first, null, 2));

    if (first.checked !== 2) {
      throw new Error(`Expected checked=2, got ${first.checked}.`);
    }
    if (first.processed !== 2) {
      throw new Error(
        `Expected processed=2, got ${first.processed}. Results: ${JSON.stringify(first.results)}`,
      );
    }
    const bothFed =
      first.results.length === 2 &&
      first.results.every((r) => r.status === "processed" && r.note.trim().length > 0);
    if (!bothFed) {
      throw new Error(
        `Expected both emails fed through runAgent with a non-empty note. Got: ${JSON.stringify(first.results)}`,
      );
    }

    // Confirm runAgent actually persisted a version for the throwaway service —
    // proof the mail layer drove the real core, not a stub.
    const { count: versionCount } = await supabase
      .from("agreement_versions")
      .select("id", { count: "exact", head: true })
      .eq("service", SERVICE);
    console.log(`agreement_versions for ${SERVICE}: ${versionCount} (expect >= 1)`);
    if (!versionCount || versionCount < 1) {
      throw new Error("Expected runAgent to persist at least one agreement version.");
    }

    // Confirm the mail path PERSISTED a report (source='mail') + answer rows — proof
    // mail-processed emails now produce visible reports, not nothing.
    const { count: reportCount } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("service", SERVICE)
      .eq("source", "mail");
    console.log(`reports for ${SERVICE} (source='mail'): ${reportCount} (expect >= 1)`);
    if (!reportCount || reportCount < 1) {
      throw new Error(
        "Expected the mail path to persist at least one report with source='mail'.",
      );
    }
    const { count: answerCount } = await supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("service", SERVICE);
    console.log(`answers for ${SERVICE}: ${answerCount} (expect >= 1)`);
    if (!answerCount || answerCount < 1) {
      throw new Error("Expected the mail path to create at least one answer row.");
    }

    // (3) second check — dedup: nothing new to process.
    console.log("\n--- (3) runMailCheck (second pass — idempotency) ---");
    const second = await runMailCheck(mockSource);
    console.log("summary:", JSON.stringify(second, null, 2));
    if (second.checked !== 0 || second.processed !== 0) {
      throw new Error(
        `Expected checked=0, processed=0 on re-run (dedup). Got checked=${second.checked}, processed=${second.processed}.`,
      );
    }

    console.log("\n✅ all mail-check assertions passed");
  } finally {
    // (4) cleanup — always, even if an assertion failed.
    await cleanup();
    const { count: leftoverInbox } = await supabase
      .from("mock_inbox")
      .select("id", { count: "exact", head: true })
      .like("id", "ZZZ_%");
    const { count: leftoverVersions } = await supabase
      .from("agreement_versions")
      .select("id", { count: "exact", head: true })
      .eq("service", SERVICE);
    const { count: leftoverReports } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("service", SERVICE);
    const { count: leftoverAnswers } = await supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("service", SERVICE);
    console.log(
      `\n--- (4) cleanup done — leftover mock_inbox: ${leftoverInbox}, versions: ${leftoverVersions}, reports: ${leftoverReports}, answers: ${leftoverAnswers} (expect 0, 0, 0, 0) ---`,
    );
  }
}

main().catch((err) => {
  console.error("\n!!! test_mailcheck failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
