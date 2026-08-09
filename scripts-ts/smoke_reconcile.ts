/**
 * scripts-ts/smoke_reconcile.ts — FREE smoke test for CaseClassifier reconciliation.
 *
 * Exercises the pure reconcileClassifications() with hand-built fixtures. NO LLM call,
 * NO embedding, NO Pinecone query, NO network of any kind — it costs zero tokens.
 *
 * Run:  npx tsx scripts-ts/smoke_reconcile.ts
 *
 * lib/config.ts validates the required env vars at import time, and this test must run
 * without an env file, so placeholder values are set BEFORE the module is imported
 * (`??=` leaves real values alone if you do pass --env-file). Nothing here ever calls
 * chat()/embed()/queryCases(), so no client is ever constructed and no key is used.
 */

import type { Clause, ClauseCaseClassification, CaseMatch } from "@/lib/contracts";

for (const name of [
  "LLMOD_API_KEY",
  "LLMOD_BASE_URL",
  "PINECONE_API_KEY",
  "PINECONE_INDEX_NAME",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  process.env[name] ??= "smoke-test-placeholder";
}

// --- Fixtures ---------------------------------------------------------------

const SENT: Clause[] = [
  { id: "c1", text: "You grant us a worldwide licence to your content." },
  { id: "c2", text: "We may share personal data with advertising partners." },
  { id: "c3", text: "We may change these terms at any time." },
];

/** Authoritative candidate metadata, positionally aligned with SENT. Fabricated —
 *  this is exactly what Pinecone would have returned, minus the network. */
function candidate(case_id: string, title: string): CaseMatch {
  return {
    case_id,
    title,
    description: "",
    classification: "bad",
    weight: 60,
    topic_id: "t1",
    topic_name: "Ownership",
    topic: "Ownership",
    score: 0.9,
  };
}

const CANDIDATE_MAPS: Map<string, CaseMatch>[] = [
  new Map([["100", candidate("100", "Content licence granted")]]),
  new Map([["200", candidate("200", "Data shared for advertising")]]),
  new Map([["300", candidate("300", "Terms changed unilaterally")]]),
];

function result(clause_id: string, case_id?: string) {
  return {
    clause_id,
    cases: case_id ? [{ case_id, confidence: 0.9 }] : [],
  };
}

// --- Tiny assertion harness -------------------------------------------------

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function ids(out: ClauseCaseClassification[]): string {
  return out.map((o) => o.clause_id).join(",");
}

// --- Cases ------------------------------------------------------------------

async function main(): Promise<void> {
  // Imported dynamically so the env placeholders above are in place first.
  const { reconcileClassifications } = await import("@/lib/modules/caseClassifier");

  check("a) exact match: 3 sent, 3 returned, ids aligned -> 3 out, order preserved", () => {
    const out = reconcileClassifications(
      SENT,
      [result("c1", "100"), result("c2", "200"), result("c3", "300")],
      CANDIDATE_MAPS,
    );
    assert(out.length === 3, `expected 3 out, got ${out.length}`);
    assert(ids(out) === "c1,c2,c3", `expected order c1,c2,c3, got ${ids(out)}`);
    assert(out[0].cases.length === 1, "c1 should have 1 matched case");
    assert(out[0].cases[0].case_id === "100", "c1 should map to case 100");
    assert(out[0].cases[0].title === "Content licence granted", "title must come from candidate metadata");
    assert(out[1].clause_text === SENT[1].text, "clause_text must be carried through");
  });

  check("b) EXTRA entry: 3 sent, 4 returned (one unknown id) -> 3 out, extra dropped", () => {
    const out = reconcileClassifications(
      SENT,
      [result("c1", "100"), result("c2", "200"), result("c3", "300"), result("c999", "100")],
      CANDIDATE_MAPS,
    );
    assert(out.length === 3, `expected 3 out, got ${out.length}`);
    assert(ids(out) === "c1,c2,c3", `expected c1,c2,c3, got ${ids(out)}`);
    assert(!out.some((o) => o.clause_id === "c999"), "the unknown id must not appear in the output");
  });

  check("c) DUPLICATE id: 3 sent, 4 returned (one id twice) -> 3 out, first kept", () => {
    const out = reconcileClassifications(
      SENT,
      [
        result("c1", "100"), // first occurrence — this one must win
        result("c2", "200"),
        result("c1"), // duplicate with NO cases — must be ignored
        result("c3", "300"),
      ],
      CANDIDATE_MAPS,
    );
    assert(out.length === 3, `expected 3 out, got ${out.length}`);
    assert(ids(out) === "c1,c2,c3", `expected c1,c2,c3, got ${ids(out)}`);
    assert(
      out[0].cases.length === 1 && out[0].cases[0].case_id === "100",
      "first occurrence of c1 must win (expected 1 case, id 100)",
    );
  });

  check("d) MISSING entry: 3 sent, 2 returned -> 3 out, the missing one has cases: []", () => {
    const out = reconcileClassifications(
      SENT,
      [result("c1", "100"), result("c3", "300")],
      CANDIDATE_MAPS,
    );
    assert(out.length === 3, `expected 3 out, got ${out.length}`);
    assert(ids(out) === "c1,c2,c3", `expected c1,c2,c3, got ${ids(out)}`);
    assert(out[1].clause_id === "c2", "the unmatched clause must still be present, in place");
    assert(out[1].cases.length === 0, "the unmatched clause must have an empty cases array");
    assert(out[1].clause_text === SENT[1].text, "the unmatched clause must keep its text");
    assert(out[0].cases.length === 1 && out[2].cases.length === 1, "matched clauses keep their cases");
  });

  check("e) TRUNCATED/garbage: 3 sent, 0 valid entries -> throws", () => {
    let threw = false;
    try {
      reconcileClassifications(SENT, [{ nope: 1 }, "junk", null, result("cX", "100")], CANDIDATE_MAPS);
    } catch (err) {
      threw = true;
      const msg = err instanceof Error ? err.message : String(err);
      assert(msg.includes("CaseClassifier"), "error must be descriptive and name the module");
      assert(msg.includes("reconciliation"), "error must say reconciliation produced nothing usable");
    }
    assert(threw, "expected reconcileClassifications to throw when nothing survives");

    // An empty array is likewise catastrophic.
    let threwEmpty = false;
    try {
      reconcileClassifications(SENT, [], CANDIDATE_MAPS);
    } catch {
      threwEmpty = true;
    }
    assert(threwEmpty, "expected a throw when the model returned an empty array");
  });

  check("f) order: results returned shuffled -> output still in SENT order", () => {
    const out = reconcileClassifications(
      SENT,
      [result("c3", "300"), result("c1", "100"), result("c2", "200")],
      CANDIDATE_MAPS,
    );
    assert(out.length === 3, `expected 3 out, got ${out.length}`);
    assert(ids(out) === "c1,c2,c3", `expected SENT order c1,c2,c3, got ${ids(out)}`);
    assert(out[0].cases[0].case_id === "100", "c1 must keep ITS case (100), not c3's");
    assert(out[1].cases[0].case_id === "200", "c2 must keep ITS case (200)");
    assert(out[2].cases[0].case_id === "300", "c3 must keep ITS case (300)");
  });

  console.log(
    failures === 0
      ? "\nAll 6 cases PASS — reconciliation is id-based, order-preserving, and fails only when nothing survives."
      : `\n${failures} case(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();