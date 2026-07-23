/**
 * app/preferences/page.tsx — the Preferences tab as the ANSWER-LOG view (step 4b).
 *
 * Server component (dynamic — reads live Supabase state each request). Two modes:
 *   - DEFAULT (no ?cases): the answer log — every ANSWERED answers row.
 *   - DEEP-LINK (?category=&cases=): exactly those cases at the given category,
 *     using an existing answered stance if present else unanswered, with taxonomy
 *     title/description so first-time stances can be set (e.g. from Standing issues).
 *
 * The taxonomy (data/tosdr_cases.json) supplies human text + severity for each case.
 */

import { listAnsweredAnswers, STANDALONE_ANSWER_SERVICE } from "@/lib/db";
import type { Classification } from "@/lib/contracts";
import AppShell from "@/components/shell/AppShell";
import PreferencesEditor from "@/components/preferences/PreferencesEditor";
import type { EditorRow } from "@/components/preferences/PreferencesEditor";
import tosdrCases from "@/data/tosdr_cases.json";

export const dynamic = "force-dynamic";

interface RawCase {
  case_id: number | string;
  title: string;
  description: string;
  classification: string;
  topic_name: string;
}

/** Taxonomy lookup by case_id (string): text + severity for a case. */
const TAXONOMY = new Map<string, { title: string; description: string; classification: Classification }>(
  (tosdrCases as unknown as RawCase[]).map((c) => [
    String(c.case_id),
    { title: c.title, description: c.description, classification: c.classification as Classification },
  ]),
);

/** First value of a (possibly repeated / absent) search param. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const answered = await listAnsweredAnswers();

  const params = await searchParams;
  const categoryParam = firstParam(params.category);
  const category = categoryParam && categoryParam.trim() !== "" ? categoryParam : "*";

  const casesParam = firstParam(params.cases);
  const caseFilter = casesParam
    ? casesParam.split(",").map((id) => id.trim()).filter((id) => id !== "")
    : null;

  let rows: EditorRow[];
  let mode: "log" | "deeplink";

  if (caseFilter && caseFilter.length > 0) {
    mode = "deeplink";
    // Existing answered stance (at this category) per case, if any.
    const existing = new Map<string, { stance: "care" | "dont_care"; service: string }>();
    for (const a of answered) {
      if (a.category === category && a.stance !== null) {
        existing.set(a.case_id, { stance: a.stance, service: a.service });
      }
    }
    rows = caseFilter.map((caseId) => {
      const tax = TAXONOMY.get(caseId);
      const ex = existing.get(caseId);
      return {
        key: caseId,
        service: ex?.service ?? STANDALONE_ANSWER_SERVICE,
        category,
        case_id: caseId,
        clause: tax?.title ?? caseId,
        explanation: tax?.description ?? "",
        classification: tax?.classification ?? null,
        stance: ex?.stance ?? null,
      };
    });
  } else {
    mode = "log";
    rows = answered.map((a) => {
      const tax = TAXONOMY.get(a.case_id);
      return {
        key: String(a.id),
        service: a.service,
        category: a.category,
        case_id: a.case_id,
        clause: a.clause || tax?.title || a.case_id,
        explanation: a.explanation || tax?.description || "",
        classification: tax?.classification ?? null,
        stance: a.stance,
      };
    });
  }

  return (
    <AppShell>
      <PreferencesEditor rows={rows} mode={mode} deepLinkCategory={mode === "deeplink" ? category : null} />
    </AppShell>
  );
}