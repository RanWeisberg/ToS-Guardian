"use client";

/**
 * components/add-agreement/agreementDraftContext.tsx
 *
 * A tiny client-side store for the add-agreement screen, mounted ONCE in the root
 * layout (app/layout.tsx), which stays mounted across App-Router navigations — so
 * its contents SURVIVE navigating to a report and back within the session, even
 * though the page component itself unmounts. React state only; no localStorage/
 * sessionStorage.
 *
 * It holds:
 *   - the DRAFT: the service name + pasted agreement text;
 *   - the last completed live run's RESULT (steps trace, response line, reportId),
 *     so the trace + result are restored on return rather than reset to the sample
 *     view (`runResult === null` means no live run has completed yet); and
 *   - the token-saving run GUARD (`lastSubmitted`): the exact agreement text last
 *     submitted, so an already-reviewed agreement stays guarded across navigation.
 *
 * clearDraft() resets ALL of the above. It is called only when a report has been
 * fully answered (see app/report/[id]/ReportView.tsx). A partial answer, a plain
 * Back, or browser-back all leave everything untouched.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Step } from "@/lib/trace";

/** The persisted result of the last successful live /api/execute run. */
export interface RunResult {
  /** The real ordered LLM `steps` trace, exactly as /api/execute returned it. */
  steps: Step[];
  /** The short plain-text response line; null when the run was silent. */
  response: string | null;
  /** The persisted report id, or null when the run produced no report. */
  reportId: string | null;
}

interface AgreementDraft {
  service: string;
  agreement: string;
  setService: (value: string) => void;
  setAgreement: (value: string) => void;
  /** The last completed live run's result, or null when none has completed. */
  runResult: RunResult | null;
  setRunResult: (result: RunResult | null) => void;
  /** Token-saving guard: the exact agreement text last submitted to /api/execute,
   *  or null when nothing has been submitted yet. */
  lastSubmitted: string | null;
  setLastSubmitted: (value: string | null) => void;
  /** Reset the draft, the persisted run result, AND the guard (used only after a
   *  report is fully answered). */
  clearDraft: () => void;
}

const AgreementDraftContext = createContext<AgreementDraft | null>(null);

export function AgreementDraftProvider({
  children,
  initialService = "",
  initialAgreement = "",
}: {
  children: ReactNode;
  initialService?: string;
  initialAgreement?: string;
}) {
  const [service, setService] = useState(initialService);
  const [agreement, setAgreement] = useState(initialAgreement);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);

  function clearDraft() {
    setService("");
    setAgreement("");
    setRunResult(null);
    setLastSubmitted(null);
  }

  return (
    <AgreementDraftContext.Provider
      value={{
        service,
        agreement,
        setService,
        setAgreement,
        runResult,
        setRunResult,
        lastSubmitted,
        setLastSubmitted,
        clearDraft,
      }}
    >
      {children}
    </AgreementDraftContext.Provider>
  );
}

export function useAgreementDraft(): AgreementDraft {
  const ctx = useContext(AgreementDraftContext);
  if (!ctx) {
    throw new Error("useAgreementDraft must be used within <AgreementDraftProvider>.");
  }
  return ctx;
}