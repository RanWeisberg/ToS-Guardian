/**
 * scripts-ts/test_gmail_source.ts — Phase 6b Gmail connectivity check (READ-ONLY).
 *
 * Constructs the real gmailSource and calls fetchNewChangeNotices(), then logs how
 * many candidate change-notice emails it found plus each one's subject + sender-
 * derived service hint. It is deliberately harmless:
 *   - it does NOT call runAgent (spends ZERO LLM budget),
 *   - it does NOT markProcessed anything (touches no ledger),
 *   - it NEVER prints full bodies or any token/secret.
 *
 * A pure connectivity + query sanity check for the demo mailbox. Requires
 * GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN in .env.local
 * (mint the token with scripts-ts/mint_gmail_token.ts first).
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/test_gmail_source.ts
 */

import { gmailSource } from "@/lib/mail/gmailSource";
import { GMAIL_REFRESH_TOKEN } from "@/lib/config";

/** Truncate a subject for tidy one-line output (no bodies are ever printed). */
function short(s: string, n = 90): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

async function main() {
  if (!GMAIL_REFRESH_TOKEN) {
    throw new Error(
      "GMAIL_REFRESH_TOKEN is not set — cannot run the Gmail connectivity check. " +
        "Mint one with `npx tsx --env-file=.env.local scripts-ts/mint_gmail_token.ts`.",
    );
  }

  console.log("\n--- Gmail source connectivity check (read-only) ---");
  const notices = await gmailSource.fetchNewChangeNotices();

  console.log(`\nFound ${notices.length} candidate change-notice email(s):\n`);
  notices.forEach((n, i) => {
    console.log(`  [${i + 1}] service_hint: ${n.service_hint ?? "(none)"}`);
    console.log(`      subject:      ${short(n.subject)}`);
    console.log(`      received_at:  ${n.received_at}`);
    console.log(`      body length:  ${n.body.length} chars (not shown)`);
  });

  if (notices.length === 0) {
    console.log(
      "  (none — either the mailbox has no matching mail, or all matches are " +
        "already in the processed_emails ledger.)",
    );
  }

  console.log("\n✅ Gmail source reachable — no runAgent call, nothing marked processed.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n!!! test_gmail_source failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});