"use client";

/**
 * app/page.tsx — the root URL, and the agent GUI itself.
 *
 * The graded bare interface lives HERE, at "/": a prompt textarea, a Run Agent
 * button that calls POST /api/execute, the final `response`, and the full steps
 * trace. Renders <AddAgreement /> (seeded with sampleRun for the initial trace
 * display) inside the shared <AppShell />. On a successful live run,
 * <AddAgreement /> captures the persisted report id and calls onSeeResults(id);
 * we navigate to the real /report/[id]. Until then, "See what I found →" stays
 * disabled.
 *
 * /add-agreement now redirects here; the Dashboard remains a nav tab.
 */

import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import AddAgreement from "@/components/add-agreement/AddAgreement";
import { sampleRun } from "@/components/add-agreement/sampleRun";

export default function Home() {
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