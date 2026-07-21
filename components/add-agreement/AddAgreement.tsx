"use client";

/**
 * components/add-agreement/AddAgreement.tsx
 *
 * The add-agreement / execute screen (PROJECT_SPEC.md §7 Tab 4 — "doubles as the
 * graded bare interface"): paste an agreement, name the service (the agent infers
 * the category itself — there is NO category field), hit "Review it for me", and
 * watch the agent work through it as an ordered, friendly step list.
 *
 * Phase 7 Step B: WIRED to the real POST /api/execute. On submit it frames the
 * input as an onboarding request, calls the endpoint, and renders the REAL
 * `steps` trace and REAL `response` that come back. The sample data (passed as
 * props) is only the initial-state display before the first live run.
 *
 * IMPORTANT (grading requirement, CLAUDE.md §3): the UI shows FRIENDLY labels, but
 * every step's real frozen module name (`step.module`) stays untouched in the data
 * so the graded trace view keeps it. The friendly label is a *display* lookup
 * (MODULE_LABELS) keyed by the real ModuleName — the real name is never replaced
 * anywhere in the data.
 */

import { useState } from "react";
import type { Step } from "@/lib/trace";
import { MODULES } from "@/lib/modules";
import type { ModuleName } from "@/lib/modules";
import { runExecute } from "./runExecute";
import styles from "./AddAgreement.module.css";

/**
 * Friendly, user-facing label for each frozen module name. Display only — the
 * real ModuleName remains the key and stays in `step.module` in the data. The
 * five LLM modules are the ones that actually appear in the `steps` trace
 * (CLAUDE.md §3); the mechanical three are mapped too so the lookup is total.
 */
export const MODULE_LABELS: Record<ModuleName, string> = {
  [MODULES.IntakeRouter]: "Understanding your request",
  [MODULES.DocumentResolver]: "Fetching the document",
  [MODULES.ClauseExtractor]: "Reading the fine print",
  [MODULES.CaseClassifier]: "Matching known issues",
  [MODULES.VersionDiffer]: "Checking what changed",
  [MODULES.MaterialityJudge]: "Deciding what matters to you",
  [MODULES.ReportComposer]: "Writing your summary",
  [MODULES.StateWriter]: "Saving your record",
};

export interface AddAgreementProps {
  /** Sample trace shown in the initial state, before the first live run. */
  steps?: Step[];
  /** Prefilled service name (the agent infers the category itself). */
  serviceValue?: string;
  /** Prefilled agreement text. */
  agreementValue?: string;
  /** Whether the initial/sample trace represents a completed run. */
  done?: boolean;
  /** Open the persisted report for a completed run. Called with the report id
   *  captured from the live /api/execute run. */
  onSeeResults?: (reportId: string) => void;
}

/** The run lifecycle for one review. */
type RunState = "initial" | "loading" | "success" | "error";

// --- Safe, read-only accessors over the (typed-as-unknown) Step.response ------
// Each reads ONLY real contract field names (lib/contracts.ts) and degrades
// gracefully, so a friendly description never throws on an unexpected shape.

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Friendly, plain-language description of what a step did, derived from the real
 * module output carried in `step.response`. Uses only real contract fields.
 */
function describeStep(step: Step): string {
  const r = step.response;
  switch (step.module) {
    case MODULES.IntakeRouter: {
      const o = asRecord(r);
      const service = typeof o.service === "string" && o.service ? o.service : "this";
      const cat = typeof o.category === "string" && o.category ? ` (${o.category})` : "";
      if (o.kind === "change_notice") return `Recognized this as a change to ${service}'s terms${cat}`;
      if (o.kind === "out_of_scope") return "This didn't look like an agreement to review";
      return `Recognized this as a new ${service}${cat} agreement`;
    }
    case MODULES.ClauseExtractor: {
      const n = Array.isArray(r) ? r.length : 0;
      return `Broke the agreement into ${count(n, "clear term", "clear terms")}`;
    }
    case MODULES.CaseClassifier: {
      const n = Array.isArray(r) ? r.length : 0;
      return `Matched ${n === 1 ? "it" : "them"} to ${count(n, "known concern type", "known concern types")}`;
    }
    case MODULES.MaterialityJudge: {
      const items = asRecord(r).items;
      const list = Array.isArray(items) ? items : [];
      const material = list.filter((i) => asRecord(i).material === true).length;
      if (material === 0) return "Nothing here needs your attention right now";
      if (material === list.length) return `All ${material} look worth your attention`;
      return `${material} of ${list.length} look worth your attention`;
    }
    case MODULES.ReportComposer:
      return "Prepared your plain-language report";
    default:
      return MODULE_LABELS[step.module];
  }
}

export default function AddAgreement({
  steps: sampleSteps = [],
  serviceValue = "",
  agreementValue = "",
  done: sampleDone = false,
  onSeeResults,
}: AddAgreementProps) {
  const [service, setService] = useState(serviceValue);
  const [agreement, setAgreement] = useState(agreementValue);
  const [runState, setRunState] = useState<RunState>("initial");
  const [liveSteps, setLiveSteps] = useState<Step[]>([]);
  const [response, setResponse] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);
  // The persisted report id from the last successful run (enables "See what I
  // found →" and the /report/[id] navigation).
  const [reportId, setReportId] = useState<string | null>(null);
  // TOKEN-SAVING GUARD: the exact agreement text last SUBMITTED to /api/execute.
  // The run button stays disabled while the textarea still holds this text, so an
  // identical agreement can't be re-run and waste budget.
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);

  // Before the first live run we show the sample trace (the design-mock state);
  // once a run succeeds we show only the real data returned by /api/execute.
  const showingLive = runState === "success";
  const displaySteps = showingLive ? liveSteps : sampleSteps;
  const isDone = showingLive ? true : sampleDone;
  const loading = runState === "loading";

  // Already reviewed this exact agreement → block re-submitting it (budget).
  const alreadyReviewed =
    lastSubmitted !== null && agreement.trim() === lastSubmitted;
  const runDisabled = loading || alreadyReviewed;

  async function handleReview() {
    const svc = service.trim();
    const text = agreement.trim();

    // Empty input: gently prompt rather than calling the API.
    if (!svc || !text) {
      setValidationHint(
        !svc && !text
          ? "Add the service name and paste the agreement, and I'll take a look."
          : !svc
            ? "What service is this agreement for? Add its name and I'll review it."
            : "Paste the agreement text and I'll review it for you.",
      );
      return;
    }

    // Guard: don't re-run the identical agreement (belt-and-braces with runDisabled).
    if (alreadyReviewed) return;

    setValidationHint(null);
    setErrorMessage(null);
    setResponse(null);
    setRunState("loading");

    // Frame the input as an onboarding request. No category — the agent infers it.
    const prompt = `I'm signing up for ${svc}. Here is the agreement I'm being asked to accept:\n\n${text}`;

    try {
      const { data, reportId: newReportId } = await runExecute(prompt);
      if (data.status === "ok") {
        setLiveSteps(data.steps ?? []);
        setResponse(data.response);
        setReportId(newReportId);
        // Remember what we just reviewed → keep the run button disabled until the
        // agreement text changes. Only on success (errors stay retryable).
        setLastSubmitted(text);
        setRunState("success");
      } else {
        setErrorMessage(
          data.error ?? "Something went wrong while reviewing this agreement.",
        );
        setRunState("error");
      }
    } catch {
      setErrorMessage(
        "I couldn't reach the review service. Check your connection and try again.",
      );
      setRunState("error");
    }
  }

  return (
    <div className={styles.page}>
      {/* Top bar + tab nav are provided by the shared <AppShell> (Phase 7 Step A). */}

      {/* Headline */}
      <div className={styles.headline}>
        <h1 className={styles.title}>What are you really agreeing to?</h1>
        <p className={styles.subtitle}>
          Paste an agreement and I&apos;ll tell you what matters — in plain language.
        </p>
      </div>

      {/* Working area */}
      <div className={styles.work}>
        {/* Input */}
        <div className={`${styles.card} ${styles.inputCard}`}>
          <h2 className={styles.cardHeading}>Review an agreement</h2>

          <textarea
            className={styles.textarea}
            placeholder="Paste a terms-of-service or privacy policy here…"
            value={agreement}
            onChange={(e) => {
              setAgreement(e.target.value);
              if (validationHint) setValidationHint(null);
            }}
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="service">
              Service
            </label>
            <input
              id="service"
              className={styles.input}
              placeholder="e.g. Acme Cloud"
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                if (validationHint) setValidationHint(null);
              }}
            />
          </div>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleReview}
            disabled={runDisabled}
          >
            {loading ? "Reviewing…" : "Review it for me"}
          </button>

          {validationHint ? (
            <p className={styles.hintNotice}>{validationHint}</p>
          ) : alreadyReviewed ? (
            <p className={styles.hintNotice}>
              Already reviewed — edit the agreement to run again.
            </p>
          ) : (
            <p className={styles.reassurance}>
              I only flag the things that actually affect you.
            </p>
          )}
        </div>

        {/* Progress / trace */}
        <div className={`${styles.card} ${styles.progressCard}`}>
          <h2 className={styles.cardHeading}>Working through it…</h2>

          {runState === "error" ? (
            <div className={styles.errorBox}>
              <div className={styles.errorTitle}>I couldn&apos;t finish that review</div>
              <div className={styles.errorText}>{errorMessage}</div>
              <button type="button" className={styles.retryBtn} onClick={handleReview}>
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className={styles.working}>
              <div className={styles.spinner} aria-hidden="true" />
              <div>
                <div className={styles.stepName}>Reading it now…</div>
                <div className={styles.stepDesc}>
                  Understanding your request, reading the fine print, matching known
                  issues, and deciding what matters to you. This takes a few seconds.
                </div>
              </div>
            </div>
          ) : displaySteps.length === 0 ? (
            <div className={styles.hintBody}>
              Paste an agreement and name the service, then hit{" "}
              <strong>Review it for me</strong> — I&apos;ll show my work here, step by
              step.
            </div>
          ) : (
            <>
              <div className={styles.steps}>
                {displaySteps.map((step, i) => (
                  <div className={styles.step} key={`${step.module}-${i}`}>
                    <div className={styles.stepNum}>{i + 1}</div>
                    <div className={styles.stepBody}>
                      {/* Friendly display label; real module name stays in step.module */}
                      <div className={styles.stepName}>{MODULE_LABELS[step.module]}</div>
                      <div className={styles.stepDesc}>{describeStep(step)}</div>
                    </div>
                    <div className={styles.stepCheck}>
                      <div className={styles.stepCheckMark} />
                    </div>
                  </div>
                ))}
              </div>

              {showingLive && response && (
                <div className={styles.responseBox}>
                  <div className={styles.responseLabel}>Here&apos;s what I found</div>
                  <div className={styles.responseText}>{response}</div>
                </div>
              )}

              <div className={styles.divider} />

              <div className={styles.footer}>
                <span className={styles.footerStatus}>
                  {isDone
                    ? `Done — ${count(displaySteps.length, "step", "steps")}`
                    : "Working through it…"}
                </span>
                {isDone && (
                  <button
                    type="button"
                    className={`${styles.seeBtn} ${reportId ? "" : styles.seeBtnDisabled}`}
                    onClick={() => reportId && onSeeResults?.(reportId)}
                    disabled={!reportId}
                    title={reportId ? undefined : "Run a review to see the full report"}
                  >
                    See what I found →
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}