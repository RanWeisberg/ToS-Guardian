"use client";

/**
 * app/add-agreement/page.tsx — the execute / add-agreement screen (the graded
 * bare interface, and the app's default landing screen).
 *
 * Renders <AddAgreement /> (seeded with sampleRun for the initial state) inside
 * the shared <AppShell />. On a successful live run, <AddAgreement /> captures
 * the persisted report id and calls onSeeResults(id); we navigate to the real
 * /report/[id]. Until then, "See what I found →" stays disabled.
 */

import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import AddAgreement from "@/components/add-agreement/AddAgreement";
import { sampleRun } from "@/components/add-agreement/sampleRun";

export default function AddAgreementPage() {
  const router = useRouter();
  return (
    <AppShell>
      <AddAgreement
        {...sampleRun}
        onSeeResults={(reportId) => router.push(`/report/${reportId}`)}
      />
    </AppShell>
  );
}
