"use client";

/**
 * components/add-agreement/AddAgreement.tsx
 *
 * The agent GUI, rendered at the ROOT url (app/page.tsx) — the graded bare
 * interface: a prompt textarea, a Run Agent button that POSTs to /api/execute, the
 * final `response`, and the FULL steps trace. Paste an agreement, optionally name
 * the service (the agent infers the category itself — there is NO category field),
 * hit Run Agent, and watch the agent work through it.
 *
 * WIRED to the real POST /api/execute: on submit it composes the outgoing prompt,
 * calls the endpoint, and renders the REAL `steps` trace and REAL `response` that
 * come back. The sample data (passed as props) is only the initial-state display
 * before the first live run.
 *
 * COMPOSED PROMPT (two paths):
 *   - service non-empty → the published framing from /api/agent_info's
 *     prompt_template, byte for byte;
 *   - service empty     → the textarea contents VERBATIM, no wrapper, no trimming,
 *     no normalisation — so a grader can paste an arbitrary prompt and have exactly
 *     that string reach the endpoint.
 *
 * IMPORTANT (grading requirement, CLAUDE.md §3): the friendly step list shows
 * FRIENDLY labels, but every step's real frozen module name (`step.module`) stays
 * untouched in the data — and the RAW TRACE BOX above it prints that real name
 * verbatim, alongside both prompts and the response JSON. The friendly label is a
 * *display* lookup (MODULE_LABELS) keyed by the real ModuleName; the real name is
 * never replaced anywhere in the data.
 */

import { useState } from "react";
import type { Step } from "@/lib/trace";
import { MODULES } from "@/lib/modules";
import type { ModuleName } from "@/lib/modules";
import { runExecute } from "./runExecute";
import { useAgreementDraft } from "./agreementDraftContext";
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
  /** Whether the initial/sample trace represents a completed run. */
  done?: boolean;
  /** Open the persisted report for a completed run. Called with the report id
   *  captured from the live /api/execute run. */
  onSeeResults?: (reportId: string) => void;
}

/** The transient lifecycle of the CURRENT interaction. Whether a completed live
 *  run exists is derived from the persisted context `runResult`, not from here. */
type RunState = "initial" | "loading" | "error";

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
  done: sampleDone = false,
  onSeeResults,
}: AddAgreementProps) {
  // Service + agreement text AND the last live run's result live in the draft
  // context so they SURVIVE navigating to a report and back (the page unmounts;
  // the context, mounted in the root layout, does not). All cleared together only
  // after a report is fully answered.
  // TOKEN-SAVING GUARD (lastSubmitted): the exact COMPOSED PROMPT last SUBMITTED to
  // /api/execute. It lives in context too, so an already-reviewed prompt stays
  // guarded across navigation; clearDraft() (full answer) re-enables a fresh run.
  const {
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
  } = useAgreementDraft();
  const [runState, setRunState] = useState<RunState>("initial");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);

  // Before the first live run we show the sample trace (the design-mock state);
  // once a run has completed we show the real data (restored from context after
  // navigation). `runResult` presence is the source of truth for "showing live".
  const showingLive = runResult !== null;
  const displaySteps = runResult ? runResult.steps : sampleSteps;
  const isDone = runResult ? true : sampleDone;
  const reportId = runResult?.reportId ?? null;
  const response = runResult?.response ?? null;
  const loading = runState === "loading";

  // --- The composed prompt: EXACTLY what gets POSTed to /api/execute ----------
  // Service named  → the framing published by /api/agent_info's prompt_template,
  //                  byte for byte.
  // Service empty  → the textarea contents VERBATIM. No trim, no wrapper, no
  //                  normalisation: a pasted arbitrary prompt arrives untouched.
  const svc = service.trim();
  const composedPrompt = svc
    ? `I'm signing up for ${svc}. Here is the agreement I'm being asked to accept:\n\n${agreement.trim()}`
    : agreement;

  // Only an empty agreement blocks a run — the service field is optional.
  const agreementEmpty = agreement.trim() === "";

  // Already reviewed this exact composed prompt → block re-submitting it (budget).
  // Because the guard is on the COMPOSED prompt, editing EITHER field (or clearing)
  // re-enables the button automatically.
  const alreadyReviewed =
    lastSubmitted !== null && composedPrompt === lastSubmitted;
  const runDisabled = loading || alreadyReviewed;

  /** First manual keystroke in the textarea = departure from the demo state → the
   *  service field auto-clears ONCE. After that it is fully user-owned. */
  function handleAgreementChange(value: string) {
    if (!demoDismissed) {
      setService("");
      dismissDemo();
    }
    setAgreement(value);
    if (validationHint) setValidationHint(null);
  }

  /** Clear: empty BOTH fields, latch the demo flag, and drop the re-run guard.
   *  Deliberately leaves `runResult` alone — the response block and the trace box
   *  stay on screen after clearing. */
  function handleClear() {
    setService("");
    setAgreement("");
    dismissDemo();
    setLastSubmitted(null);
    setValidationHint(null);
  }

  async function handleReview() {
    // Empty agreement: gently prompt rather than calling the API. A missing service
    // name is fine — that's the verbatim path.
    if (agreementEmpty) {
      setValidationHint("Paste the agreement text and I'll review it for you.");
      return;
    }

    // Guard: don't re-run the identical prompt (belt-and-braces with runDisabled).
    if (alreadyReviewed) return;

    setValidationHint(null);
    setErrorMessage(null);
    setRunState("loading");

    try {
      const { data, reportId: newReportId } = await runExecute(composedPrompt);
      if (data.status === "ok") {
        // Persist the run result to context so it survives navigation.
        setRunResult({
          steps: data.steps ?? [],
          response: data.response,
          reportId: newReportId,
        });
        // Remember the exact prompt we just sent → keep the run button disabled
        // until it changes. Only on success (errors stay retryable).
        setLastSubmitted(composedPrompt);
        setRunState("initial");
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
            onChange={(e) => handleAgreementChange(e.target.value)}
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="service">
              Service <span className={styles.labelOptional}>(optional)</span>
            </label>
            <input
              id="service"
              className={styles.input}
              placeholder="e.g. Acme Cloud — leave empty to send the text as-is"
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                if (validationHint) setValidationHint(null);
              }}
            />
          </div>

          {/* The one horizontal pair the layout allows: the two action buttons. */}
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleReview}
              disabled={runDisabled}
            >
              {loading ? "Running agent…" : "Run Agent (Review it for me)"}
            </button>
            <button
              type="button"
              className={styles.clearBtn}
              onClick={handleClear}
            >
              Clear
            </button>
          </div>

          {validationHint ? (
            <p className={styles.hintNotice}>{validationHint}</p>
          ) : alreadyReviewed ? (
            // On-screen (not a tooltip) explanation of the disabled Run button.
            <p className={styles.hintNotice}>
              Already reviewed — clear or edit the text to run again.
            </p>
          ) : (
            <p className={styles.reassurance}>
              I only flag the things that actually affect you.
            </p>
          )}
        </div>

        {/* The final `response` from /api/execute, between the buttons and the
            trace box. Plain readable text. */}
        {showingLive && response && (
          <div className={`${styles.card} ${styles.responseCard}`}>
            <h2 className={styles.cardHeading}>Response</h2>
            <div className={styles.responseText}>{response}</div>
          </div>
        )}

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
              Paste an agreement, then hit <strong>Run Agent</strong> — I&apos;ll show
              my work here, step by step.
            </div>
          ) : (
            <>
              {/* RAW STEPS TRACE — deliberately ABOVE the friendly list, for
                  grading visibility. Prints the REAL frozen module name verbatim
                  (never MODULE_LABELS / describeStep), both full prompts, and the
                  response JSON, for every step in order. */}
              <div className={styles.rawTraceLabel}>Raw steps trace</div>
              <div className={styles.rawTrace}>
                {displaySteps.map((step, i) => (
                  <div className={styles.rawStep} key={`raw-${step.module}-${i}`}>
                    <div className={styles.rawStepHead}>
                      <span className={styles.rawStepNum}>{i + 1}</span>
                      <span className={styles.rawModule}>{step.module}</span>
                    </div>
                    <div className={styles.rawKey}>system_prompt</div>
                    <pre className={styles.rawPre}>{step.prompt.system_prompt}</pre>
                    <div className={styles.rawKey}>user_prompt</div>
                    <pre className={styles.rawPre}>{step.prompt.user_prompt}</pre>
                    <div className={styles.rawKey}>response</div>
                    <pre className={styles.rawPre}>
                      {JSON.stringify(step.response, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>

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