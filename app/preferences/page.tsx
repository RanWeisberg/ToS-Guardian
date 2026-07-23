/**
 * app/preferences/page.tsx — the Preferences tab (Chunk B).
 *
 * Server component (dynamic — reads live Supabase state each request). It loads
 * the static ToS;DR taxonomy (case metadata + topics), every stored preference
 * row, and the real service categories, then hands them to the client
 * <PreferencesEditor/>. Deep links: ?category=<cat> preselects a category and
 * ?cases=<id,id,…> filters to specific cases (both read here from searchParams).
 */

import { listAllPreferences, listCategories } from "@/lib/db";
import type { Classification } from "@/lib/contracts";
import AppShell from "@/components/shell/AppShell";
import PreferencesEditor from "@/components/preferences/PreferencesEditor";
import type { EditorCase } from "@/components/preferences/PreferencesEditor";
import tosdrCases from "@/data/tosdr_cases.json";

export const dynamic = "force-dynamic";

interface RawCase {
  case_id: number | string;
  title: string;
  classification: string;
  topic_name: string;
}

/** Taxonomy → the trimmed shape the editor needs (case_id normalized to string,
 *  matching how preferences.case_id is stored). */
const CASES: EditorCase[] = (tosdrCases as unknown as RawCase[]).map((c) => ({
  case_id: String(c.case_id),
  title: c.title,
  classification: c.classification as Classification,
  topic_name: c.topic_name ?? "",
}));

/** First value of a (possibly repeated / absent) search param. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [preferences, categories] = await Promise.all([
    listAllPreferences(),
    listCategories(),
  ]);

  const params = await searchParams;
  const categoryParam = firstParam(params.category);
  const initialCategory =
    categoryParam && categoryParam.trim() !== "" ? categoryParam : "*";

  const casesParam = firstParam(params.cases);
  const initialCaseFilter = casesParam
    ? casesParam
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== "")
    : null;

  return (
    <AppShell>
      <PreferencesEditor
        cases={CASES}
        preferences={preferences}
        categories={categories}
        initialCategory={initialCategory}
        initialCaseFilter={initialCaseFilter && initialCaseFilter.length > 0 ? initialCaseFilter : null}
      />
    </AppShell>
  );
}