/**
 * scripts-ts/test_resolver.ts — standalone smoke test for Module 2 (DocumentResolver).
 *
 * Exercises three paths:
 *   (a) inline pass-through   — no fetch, no LLM, no trace Step.
 *   (b) a real fetchable URL  — mechanical fetch + HTML-to-text extraction.
 *   (c) an unreachable URL    — the needs_user_paste fallback (no crash).
 *
 * The mechanical paths need no LLM key, but lib/config.ts validates the env at
 * import time, so run with the env file present:
 *
 *   npx tsx --env-file=.env.local scripts-ts/test_resolver.ts
 */

import { runDocumentResolver } from "@/lib/modules/documentResolver";
import { Tracer } from "@/lib/trace";
import type { DocumentResolverInput } from "@/lib/contracts";

const CASES: { label: string; input: DocumentResolverInput }[] = [
  {
    label: "(a) inline pass-through",
    input: {
      source: "inline",
      inline_text:
        "By creating an account you grant us a worldwide licence to your content. " +
        "We may collect usage data and share it with advertising partners. " +
        "You may cancel at any time; refunds are not provided for partial periods.",
      link_url: null,
    },
  },
  {
    label: "(b) real fetchable public URL",
    input: {
      source: "linked",
      inline_text: null,
      link_url: "https://www.gnu.org/licenses/gpl-3.0.txt",
    },
  },
  {
    label: "(c) unreachable / bogus URL → needs_user_paste",
    input: {
      source: "linked",
      inline_text: null,
      link_url: "https://this-domain-definitely-does-not-exist-9f8a7b6c.example/policy",
    },
  },
];

async function main() {
  for (const c of CASES) {
    console.log("\n=====================================================");
    console.log(`CASE: ${c.label}`);
    console.log("=====================================================");

    const tracer = new Tracer();
    try {
      const out = await runDocumentResolver(c.input, tracer);
      console.log("\n--- output (summary) ---");
      console.log(
        JSON.stringify(
          {
            resolved: out.resolved,
            needs_user_paste: out.needs_user_paste,
            reason: out.reason,
            text_length: out.text?.length ?? 0,
            text_preview: out.text ? out.text.slice(0, 200) + (out.text.length > 200 ? "…" : "") : null,
          },
          null,
          2,
        ),
      );
      console.log(`steps recorded: ${tracer.steps.length} (expected 0 — mechanical)`);
    } catch (err) {
      console.error("\n!!! runDocumentResolver threw (it should not):");
      console.error(err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
