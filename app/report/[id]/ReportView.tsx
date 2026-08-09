"use client";

/**
 * app/report/[id]/ReportView.tsx — the client wrapper for the persisted report.
 *
 * The parent page (a server component) fetches the row and passes serializable
 * data in; this thin client boundary supplies the router-based navigation
 * callbacks that <ReportDetail /> needs, inside the shared <AppShell />, and owns
 * the feedback network call (Phase 7 Step D): on submit it POSTs to /api/feedback
 * via submitFeedback; on success it navigates back to the agent GUI at "/", and on
 * failure it surfaces the error inline instead of navigating.
 *
 * Pre-fill: `savedStances` (the user's already-saved answers) seeds <ReportDetail />
 * via its existing `feedback` prop, so previously-answered points render selected.
 *
 * Draft clearing: the held add-agreement draft is cleared ONLY when the report is
 * now fully answered (submit returned answered:true). A partial answer, a plain
 * Back, or browser-back all preserve the draft.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import ReportDetail from "@/components/report-detail/ReportDetail";
import type { FeedbackStance } from "@/components/report-detail/ReportDetail";
import { submitFeedback } from "@/components/report-detail/submitFeedback";
import { useAgreementDraft } from "@/components/add-agreement/agreementDraftContext";
import type { MaterialFinding } from "@/lib/contracts";

export default function ReportView({
  reportId,
  service,
  category,
  findings,
  truncationNotice,
  savedStances = {},
}: {
  reportId: string;
  service: string;
  category: string;
  findings: MaterialFinding[];
  truncationNotice: string | null;
  savedStances?: Record<string, FeedbackStance>;
}) {
  const router = useRouter();
  const { clearDraft } = useAgreementDraft();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(stances: Record<string, FeedbackStance>) {
    setError(null);
    const result = await submitFeedback(reportId, stances);
    if (result.ok) {
      // Fully answered → the pasted agreement is done with; clear the held draft.
      // A partial answer leaves it untouched.
      if (result.answered) clearDraft();
      router.push("/");
    } else {
      setError(
        result.error ?? "Sorry — I couldn't save your answers. Please try again.",
      );
    }
  }

  return (
    <AppShell>
      {error && (
        <div
          role="alert"
          style={{
            maxWidth: 820,
            margin: "0 auto 8px",
            padding: "14px 18px",
            background: "#fce9e6",
            color: "#c0492f",
            borderRadius: 14,
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}
      <ReportDetail
        service={service}
        category={category}
        findings={findings}
        truncationNotice={truncationNotice}
        feedback={savedStances}
        onSubmitFeedback={handleSubmit}
        onBack={() => router.push("/")}
        onDone={() => router.push("/")}
      />
    </AppShell>
  );
}