/**
 * scripts-ts/capture_example.ts — capture one /api/execute run to a JSON file,
 * for use as an agent_info worked example.
 *
 * Reads the agreement text from a LOCAL FILE (so a huge string isn't pasted on the
 * command line), frames it EXACTLY like the AddAgreement screen, POSTs { prompt }
 * to the locally-running server's /api/execute, and on success writes the FULL
 * response envelope to scripts-ts/captured_example.json (pretty-printed) plus a
 * compact summary to stdout. On error it prints status + error and does NOT touch
 * the JSON file.
 *
 * Dev utility only — it changes NO app code, endpoints, envelope, trace, or frozen
 * names. It talks to the running server over HTTP, so it needs no secrets itself.
 *
 * Run (with the dev server up on :3000):
 *   npx tsx scripts-ts/capture_example.ts <agreement.txt> <service>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecuteResponse } from "@/lib/contracts";

const EXECUTE_URL = "http://localhost:3000/api/execute";
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "captured_example.json");

function fail(message: string): never {
  console.error(`\n!!! capture_example failed:\n${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [agreementPath, service] = process.argv.slice(2);
  if (!agreementPath || !service) {
    fail(
      "Usage: npx tsx scripts-ts/capture_example.ts <agreement.txt> <service>\n" +
        "  <agreement.txt>  path to a file containing the agreement text\n" +
        "  <service>        the service name (e.g. \"Acme Cloud\")",
    );
  }

  let text: string;
  try {
    text = readFileSync(resolve(agreementPath), "utf8");
  } catch (err) {
    fail(`Could not read agreement file "${agreementPath}": ${err instanceof Error ? err.message : String(err)}`);
  }
  if (text.trim() === "") {
    fail(`Agreement file "${agreementPath}" is empty.`);
  }

  // Frame the prompt EXACTLY like the AddAgreement screen does.
  const prompt = `I'm signing up for ${service}. Here is the agreement I'm being asked to accept:\n\n${text}`;

  console.log(`Posting to ${EXECUTE_URL} …`);
  console.log(`  service: ${service}`);
  console.log(`  agreement: ${agreementPath} (${text.length} chars)`);

  let res: Response;
  try {
    res = await fetch(EXECUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  } catch (err) {
    fail(
      `Could not reach ${EXECUTE_URL} — is the dev server running (npm run dev)?\n` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let data: ExecuteResponse;
  try {
    data = (await res.json()) as ExecuteResponse;
  } catch {
    fail(`Server returned a non-JSON response (HTTP ${res.status}).`);
  }

  // On error: print clearly and DO NOT overwrite the JSON.
  if (data.status !== "ok") {
    fail(`status: error (HTTP ${res.status})\nerror: ${data.error ?? "(none)"}`);
  }

  // Success: write the full envelope, then print a compact summary.
  writeFileSync(OUT_PATH, JSON.stringify(data, null, 2), "utf8");

  const reportId = res.headers.get("X-Report-Id");
  console.log("\n=== captured ===");
  console.log(`status:   ${data.status}`);
  console.log(`response: ${data.response}`);
  if (reportId) console.log(`reportId: ${reportId} (from X-Report-Id header)`);
  console.log(`steps:    ${data.steps.length}`);
  data.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.module}`));
  console.log(`\nSaved full envelope → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("\n!!! capture_example crashed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});