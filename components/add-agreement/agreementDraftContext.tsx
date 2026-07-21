"use client";

/**
 * components/add-agreement/agreementDraftContext.tsx
 *
 * A tiny client-side store for the add-agreement draft (service name + pasted
 * agreement text). It is mounted ONCE in the root layout (app/layout.tsx), which
 * stays mounted across App-Router navigations — so the draft SURVIVES navigating
 * to a report and back within the session, even though the page component itself
 * unmounts. React state only; no localStorage/sessionStorage.
 *
 * The draft is cleared (reset to empty) only via clearDraft(), called when a
 * report has been fully answered (see app/report/[id]/ReportView.tsx). A partial
 * answer, a plain Back, or browser-back all leave the draft untouched.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

interface AgreementDraft {
  service: string;
  agreement: string;
  setService: (value: string) => void;
  setAgreement: (value: string) => void;
  /** Reset both fields to empty (used only after a report is fully answered). */
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

  function clearDraft() {
    setService("");
    setAgreement("");
  }

  return (
    <AgreementDraftContext.Provider
      value={{ service, agreement, setService, setAgreement, clearDraft }}
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