/**
 * app/report/[id]/page.tsx — the report-detail drill-down, read from storage.
 *
 * Phase 7 Step C: fetches the persisted `reports` row by id (server-side) and
 * renders the existing <ReportDetail /> with the REAL data. The persisted
 * `points` (ReportPoint[]) are mapped onto the MaterialFinding[] shape
 * ReportDetail already consumes — no invented field names (why_it_matters →
 * reason, the DiffChange passes straight through). If the row carries a
 * truncation notice, it is shown in the report.
 *
 * A missing id 404s. The sample-data preview lives at /report (no id).
 */

import { notFound } from "next/navigation";
import { getReportById } from "@/lib/db";
import type { MaterialFinding } from "@/lib/contracts";
import ReportView from "./ReportView";

export const dynamic = "force-dynamic";

export default async function ReportByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await getReportById(id);
  if (!report) notFound();

  const findings: MaterialFinding[] = report.points.map((p) => ({
    case_id: p.case_id,
    classification: p.classification,
    weight: p.weight,
    reason: p.why_it_matters,
    change: p.change,
  }));

  return (
    <ReportView
      service={report.service}
      category={report.category}
      findings={findings}
      truncationNotice={report.truncation_notice}
    />
  );
}
