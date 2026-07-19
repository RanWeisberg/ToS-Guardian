/**
 * lib/modules/stateWriter.ts — Module 8 of the eight-module core (PROJECT_SPEC §4 row 8).
 *
 * StateWriter persists the new agreement version (raw text + clause→case classifications)
 * to the Supabase version store, applies the re-add/active logic (§8), and upserts any
 * per-point preference feedback. All cross-call state lives in Supabase — never on the
 * serverless filesystem (CLAUDE.md §2).
 *
 * MECHANICAL: this module makes NO LLM call and records NO trace Step — persistence is
 * not part of the LLM `steps` trace (CLAUDE.md §4/§5/§7). It never calls tracer.add.
 *
 * Contract: implements the frozen StateWriterInput → StateWriterOutput shape.
 */

import type { StateWriterInput, StateWriterOutput } from "@/lib/contracts";
import { supabase } from "@/lib/db";
import type { Tracer } from "@/lib/trace";

const VERSIONS_TABLE = "agreement_versions";
const PREFERENCES_TABLE = "preferences";
const UNIQUE_VIOLATION = "23505"; // Postgres unique_violation

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- tracer is unused by
// design: StateWriter is mechanical and records no Step (CLAUDE.md §4/§7).
export async function runStateWriter(
  input: StateWriterInput,
  _tracer: Tracer,
): Promise<StateWriterOutput> {
  const { service, category, version, raw_text, classifications, preferenceUpdates } = input;

  // --- Re-add / active logic (§8): writing a version for a service reactivates it.
  //     Only touch soft-flagged (inactive) rows so a normal write is a no-op. ---
  const { error: reactivateErr } = await supabase
    .from(VERSIONS_TABLE)
    .update({ active: true })
    .eq("service", service)
    .eq("active", false);
  if (reactivateErr) {
    throw new Error(
      `StateWriter: failed to reactivate service "${service}": ${reactivateErr.message}`,
    );
  }

  // --- Idempotency: respect unique (service, version). If this exact version already
  //     exists, do not duplicate — return the existing id with written=false. ---
  const existingId = await findVersionId(service, version);
  let versionId: number | null;
  let written: boolean;

  if (existingId !== null) {
    versionId = existingId;
    written = false;
  } else {
    const { data, error } = await supabase
      .from(VERSIONS_TABLE)
      .insert({ service, category, version, raw_text, classifications, active: true })
      .select("id")
      .single();

    if (error) {
      // A concurrent writer may have inserted the same (service, version) between our
      // check and this insert — treat that as idempotent rather than a hard failure.
      if (error.code === UNIQUE_VIOLATION) {
        const racedId = await findVersionId(service, version);
        if (racedId === null) {
          throw new Error(
            `StateWriter: unique violation writing "${service}" v${version} but the row could not be re-read.`,
          );
        }
        versionId = racedId;
        written = false;
      } else {
        throw new Error(
          `StateWriter: failed to write "${service}" v${version}: ${error.message}`,
        );
      }
    } else {
      versionId = data.id as number;
      written = true;
    }
  }

  // --- Preference feedback (§5, §7): per-point user overrides win over defaults.
  //     Upsert with source='user' on the (case_id, category) key. ---
  if (preferenceUpdates && preferenceUpdates.length > 0) {
    const rows = preferenceUpdates.map((u) => ({
      case_id: u.case_id,
      category: u.category,
      stance: u.stance,
      source: "user" as const,
      updated_at: new Date().toISOString(),
    }));
    const { error: prefErr } = await supabase
      .from(PREFERENCES_TABLE)
      .upsert(rows, { onConflict: "case_id,category" });
    if (prefErr) {
      throw new Error(`StateWriter: failed to upsert preference updates: ${prefErr.message}`);
    }
  }

  return { versionId, written };
}

/** Look up the id of an existing (service, version) row, or null if none. */
async function findVersionId(service: string, version: number): Promise<number | null> {
  const { data, error } = await supabase
    .from(VERSIONS_TABLE)
    .select("id")
    .eq("service", service)
    .eq("version", version)
    .maybeSingle();
  if (error) {
    throw new Error(
      `StateWriter: failed to check existing version "${service}" v${version}: ${error.message}`,
    );
  }
  return data ? (data.id as number) : null;
}
