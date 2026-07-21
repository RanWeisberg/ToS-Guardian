/**
 * scripts-ts/test_trim.ts — unit-style smoke test for the pre-trim helper.
 *
 * No API calls. Two scenarios:
 *   (a) a normal agreement laced with obvious junk → truncated=false, the junk
 *       is removed, and the real terms survive intact.
 *   (b) a synthetic over-long input → truncated=true, cut on a clean boundary
 *       (not mid-word), within the hard cap.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_trim.ts
 * (the --env-file is not needed here — no secrets are used — but keeps the
 *  invocation identical to the other test scripts.)
 */

import { trimAgreement, MAX_AGREEMENT_CHARS } from "@/lib/preprocess/trimAgreement";

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

function scenarioNormal(): void {
  console.log("\n=====================================================");
  console.log("SCENARIO A: normal agreement with junk → truncated=false");
  console.log("=====================================================");

  const raw = [
    "Home | About | Privacy | Terms | Contact",
    "",
    "1. Account   2. Content   3. Data   4. Sharing   5. Security",
    "",
    "Last updated: January 1, 2024",
    "",
    "Acme Cloud Terms of Service",
    "",
    "By creating an account, you agree that Acme may store and process the files you upload in order to provide the service.",
    "",
    "We may share your usage data with third-party advertising and analytics partners. This is a real term and must be kept.",
    "",
    "You can close your account at any time, and we will delete your content within 30 days.",
    "",
    "Acme Inc., 123 Market Street, Suite 400, San Francisco, CA 94103",
    "Contact us at support@acme.com",
    "legal@acme.com",
    "",
    "© 2024 Acme Inc. All rights reserved.",
    "",
    "",
    "",
  ].join("\n");

  const out = trimAgreement(raw);
  console.log(
    `original_length=${out.original_length} kept_length=${out.kept_length} truncated=${out.truncated}`,
  );
  console.log("\n--- cleaned text ---\n" + out.text + "\n--------------------");

  check("truncated is false", out.truncated === false);
  check("kept_length < original_length (junk removed)", out.kept_length < out.original_length);

  // Junk gone.
  check("TOC index line removed", !out.text.includes("1. Account"));
  check("nav line removed", !out.text.includes("Home | About"));
  check('"Last updated" stamp removed', !/Last updated:/i.test(out.text));
  check("postal address removed", !out.text.includes("123 Market Street"));
  check("contact line removed", !/Contact us at/i.test(out.text));
  check("email-only line removed", !out.text.includes("legal@acme.com"));
  check("copyright footer removed", !/All rights reserved/i.test(out.text));

  // Real terms intact.
  check("term: store and process files kept", out.text.includes("store and process the files you upload"));
  check("term: third-party sharing kept", out.text.includes("third-party advertising and analytics partners"));
  check("term: account deletion kept", out.text.includes("delete your content within 30 days"));

  // Whitespace collapsed (no triple newlines).
  check("blank runs collapsed", !/\n{3,}/.test(out.text));
}

function scenarioOverLong(): void {
  console.log("\n=====================================================");
  console.log("SCENARIO B: over-long input → truncated=true, clean boundary cut");
  console.log("=====================================================");

  // Full, punctuated paragraphs separated by blank lines, repeated past the cap.
  const para =
    "This clause describes a genuine term of the agreement that the user is being asked to accept, written as a complete sentence so the boundary cut has a clean paragraph break to land on.";
  const blocks: string[] = [];
  let total = 0;
  let i = 0;
  while (total < MAX_AGREEMENT_CHARS + 20_000) {
    const block = `Section ${i}. ${para}`;
    blocks.push(block);
    total += block.length + 2;
    i++;
  }
  const raw = blocks.join("\n\n");

  const out = trimAgreement(raw);
  console.log(
    `original_length=${out.original_length} kept_length=${out.kept_length} truncated=${out.truncated} cap=${MAX_AGREEMENT_CHARS}`,
  );
  console.log("\n--- tail of cut text ---\n…" + out.text.slice(-160) + "\n------------------------");

  check("truncated is true", out.truncated === true);
  check("kept_length within the hard cap", out.kept_length <= MAX_AGREEMENT_CHARS);
  check("kept_length is a large portion (not cut near the start)", out.kept_length >= MAX_AGREEMENT_CHARS * 0.5);
  check("does not end with a trailing space (clean end)", !out.text.endsWith(" "));
  check("cut landed on a sentence/paragraph boundary (ends with '.')", out.text.endsWith("."));
}

function main(): void {
  scenarioNormal();
  scenarioOverLong();
  console.log("\n=====================================================");
  if (failures === 0) {
    console.log("ALL CHECKS PASSED");
  } else {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
}

main();
