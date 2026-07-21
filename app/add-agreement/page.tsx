"use client";

/**
 * app/add-agreement/page.tsx — the execute / add-agreement screen (the graded
 * bare interface, and the app's default landing screen).
 *
 * Step A (shell only): renders the existing <AddAgreement /> with its sampleRun
 * placeholder data inside the shared <AppShell />. Nothing is wired to
 * /api/execute yet — the "See what I found →" button just navigates to the
 * report screen for now (real data flow lands in a later step).
 */

import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import AddAgreement from "@/components/add-agreement/AddAgreement";
import { sampleRun } from "@/components/add-agreement/sampleRun";

export default function AddAgreementPage() {
  const router = useRouter();
  return (
    <AppShell>
      <AddAgreement {...sampleRun} onSeeResults={() => router.push("/report")} />
    </AppShell>
  );
}
