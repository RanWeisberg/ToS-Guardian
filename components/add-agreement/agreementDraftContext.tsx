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
 *   - the one-way DEMO flag (`demoDismissed`): the screen opens pre-filled with the
 *     demo agreement (lib/demoAgreement.ts). The service field auto-clears EXACTLY
 *     ONCE, on first departure from that demo state — the first manual keystroke in
 *     the textarea, or Clear. This flag records that it has happened, so the service
 *     field is user-owned from then on and never auto-clears again;
 *   - the last completed live run's RESULT (steps trace, response line, reportId),
 *     so the trace + result are restored on return rather than reset to the sample
 *     view (`runResult === null` means no live run has completed yet); and
 *   - the token-saving run GUARD (`lastSubmitted`): the exact COMPOSED PROMPT last
 *     sent to /api/execute, so an already-reviewed prompt stays guarded across
 *     navigation. Editing either field changes the composed prompt and re-enables
 *     the run automatically.
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
  /** True once the draft has left its initial demo state. One-way: never resets. */
  demoDismissed: boolean;
  /** Mark the demo state as departed. Idempotent and irreversible — after the first
   *  call the service field is fully user-owned and must never auto-clear again. */
  dismissDemo: () => void;
  /** The last completed live run's result, or null when none has completed. */
  runResult: RunResult | null;
  setRunResult: (result: RunResult | null) => void;
  /** Token-saving guard: the exact COMPOSED PROMPT last sent to /api/execute, or
   *  null when nothing has been submitted yet. */
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
  const [demoDismissed, setDemoDismissed] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);

  /** One-way latch — only ever flips false → true. */
  function dismissDemo() {
    setDemoDismissed(true);
  }

  function clearDraft() {
    setService("");
    setAgreement("");
    // The fields are empty, so the draft has certainly left the demo state.
    setDemoDismissed(true);
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
        demoDismissed,
        dismissDemo,
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