/**
 * scripts-ts/test_intake.ts — standalone smoke test for Module 1 (IntakeRouter).
 *
 * Runs runIntakeRouter against three fixed sample prompts (one onboarding with
 * inline text, one change-notice with a link, one out-of-scope) and prints each
 * output plus the recorded Step. Makes REAL LLM calls, so LLMOD_API_KEY /
 * LLMOD_BASE_URL must be set in the environment (lib/config.ts validates this).
 *
 * Run with:  npx tsx scripts-ts/test_intake.ts
 */

import { runIntakeRouter } from "@/lib/modules/intakeRouter";
import { Tracer } from "@/lib/trace";

const SAMPLES: { label: string; prompt: string }[] = [
  {
    label: "onboarding (inline text)",
    prompt: [
      "I'm signing up for Spotify (music streaming). Here are the terms:",
      "",
      "By creating an account you grant Spotify a worldwide, non-exclusive licence to",
      "the content you upload. We may collect your usage data and share it with",
      "advertising partners. You may cancel your subscription at any time; refunds are",
      "not provided for partial billing periods. We may change these terms and will",
      "notify you of material changes.",
    ].join("\n"),
  },
  {
    label: "change_notice (linked)",
    prompt: [
      "Subject: We've updated our Privacy Policy",
      "",
      "Hi there — Dropbox is updating its Privacy Policy, effective August 1.",
      "The changes affect how we process your data for personalized features.",
      "You can review the full updated policy here:",
      "https://www.dropbox.com/privacy",
    ].join("\n"),
  },
  {
    label: "out_of_scope",
    prompt: "Hey, can you recommend a good recipe for a vegetarian lasagna for dinner tonight?",
  },
];

async function main() {
  for (const sample of SAMPLES) {
    console.log("\n=====================================================");
    console.log(`SAMPLE: ${sample.label}`);
    console.log("=====================================================");

    const tracer = new Tracer();
    try {
      const output = await runIntakeRouter({ prompt: sample.prompt }, tracer);
      console.log("\n--- output ---");
      console.log(JSON.stringify(output, null, 2));
      console.log("\n--- recorded step(s) ---");
      console.log(JSON.stringify(tracer.steps, null, 2));
      console.log(`\nsteps recorded: ${tracer.steps.length} (expected exactly 1)`);
    } catch (err) {
      console.error("\n!!! runIntakeRouter threw:");
      console.error(err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
