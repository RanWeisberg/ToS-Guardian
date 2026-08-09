"use client";

/**
 * app/report/page.tsx — the report-detail drill-down (the thesis screen).
 *
 * Step A (shell only): renders the existing <ReportDetail /> with its
 * sampleReport placeholder data inside the shared <AppShell />. Reached from the
 * agent GUI's "See what I found →" at "/"; Back / "Back to agreement" return
 * there. No live data or feedback-writing yet.
 */

import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import ReportDetail from "@/components/report-detail/ReportDetail";
import { sampleReport } from "@/components/report-detail/sampleReport";

export default function ReportPage() {
  const router = useRouter();
  return (
    <AppShell>
      <ReportDetail
        {...sampleReport}
        onBack={() => router.push("/")}
        onDone={() => router.push("/")}
      />
    </AppShell>
  );
}
