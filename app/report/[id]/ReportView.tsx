"use client";

/**
 * app/report/[id]/ReportView.tsx — the client wrapper for the persisted report.
 *
 * The parent page (a server component) fetches the row and passes serializable
 * data in; this thin client boundary supplies the router-based navigation
 * callbacks that <ReportDetail /> needs, inside the shared <AppShell />.
 */

import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import ReportDetail from "@/components/report-detail/ReportDetail";
import type { MaterialFinding } from "@/lib/contracts";

export default function ReportView({
  service,
  category,
  findings,
  truncationNotice,
}: {
  service: string;
  category: string;
  findings: MaterialFinding[];
  truncationNotice: string | null;
}) {
  const router = useRouter();
  return (
    <AppShell>
      <ReportDetail
        service={service}
        category={category}
        findings={findings}
        truncationNotice={truncationNotice}
        onBack={() => router.push("/add-agreement")}
        onDone={() => router.push("/add-agreement")}
      />
    </AppShell>
  );
}
