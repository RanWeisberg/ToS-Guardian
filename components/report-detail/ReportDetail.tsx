"use client";

/**
 * components/report-detail/ReportDetail.tsx
 *
 * The report-detail drill-down screen (PROJECT_SPEC.md §7 — "where the whole
 * thesis lives"): a change/onboarding report opened clause-by-clause. Each point
 * shows what changed, which ToS;DR case it maps to, its severity, and why it
 * matters to the user, plus a per-point care/don't-care feedback control.
 *
 * Presentational. It renders typed props and is now fed REAL persisted data by
 * /report/[id] (Phase 7 Step C). Per-point care/don't-care selections live in
 * LOCAL state (initialized from the `feedback` prop, so a later chunk can
 * pre-fill answered points); a Submit control hands the chosen stances to the
 * parent via `onSubmitFeedback`, which owns the network call (Phase 7 Step D).
 * This component does NOT fetch. It imports the *real* backend contract shapes
 * (no invented field names):
 *   - findings are `MaterialFinding[]` exactly as MaterialityJudge/ReportComposer
 *     produce them (lib/contracts.ts).
 *   - feedback stance reuses `Preference["stance"]` ("care" | "dont_care"),
 *     the same vocabulary the preference table / feedback loop persists (lib/db.ts).
 *
 * Friendly, user-facing copy lives here. The frozen module names live in the
 * `steps` trace elsewhere, never on this screen.
 */

import { useState } from "react";
import type { Classification, MaterialFinding } from "@/lib/contracts";
import type { Preference } from "@/lib/db";
import styles from "./ReportDetail.module.css";

/** The per-point feedback stance — the exact union the preference store writes. */
export type FeedbackStance = Preference["stance"]; // "care" | "dont_care"

export interface ReportDetailProps {
  /** The service this report is about (e.g. "Acme Cloud"). */
  service: string;
  /** The service category, used in the summary line (e.g. "cloud storage"). */
  category: string;
  /** The material findings, exactly as the backend produces them. */
  findings: MaterialFinding[];
  /**
   * Initial per-point feedback, keyed by `MaterialFinding.case_id`. Seeds the
   * component's local selection state (e.g. to pre-fill already-answered points).
   * Absent entries start with no take chosen.
   */
  feedback?: Record<string, FeedbackStance>;
  /** Human phrasing for when the agent reviewed this (e.g. "just now"). */
  reviewedLabel?: string;
  /** When set, the agreement was very long and only its first portion was
   *  analyzed; shown as a notice at the top of the report. */
  truncationNotice?: string | null;
  /** Fired on each point selection (optional; local state is the source of truth). */
  onFeedback?: (caseId: string, stance: FeedbackStance) => void;
  /** Fired on Submit with ONLY the points the user actually chose. The parent
   *  owns the network call. */
  onSubmitFeedback?: (stances: Record<string, FeedbackStance>) => void;
  onBack?: () => void;
  onDone?: () => void;
}

/**
 * Maps a ToS;DR `Classification` to friendly, user-facing severity language and
 * the design's chip colours. Purely presentational — the raw classification
 * stays the source of truth.
 */
const SEVERITY: Record<Classification, { label: string; bg: string; fg: string }> = {
  good: { label: "Looks fine", bg: "#eaf6f4", fg: "#0c8578" },
  neutral: { label: "Worth noting", bg: "#fdf2e1", fg: "#b8791b" },
  bad: { label: "Important", bg: "#fce9e6", fg: "#c0492f" },
  blocker: { label: "Critical", bg: "#f9dbd4", fg: "#a3341d" },
};

/**
 * The ToS;DR case a finding maps to, as a human label. Pulled from the matched
 * case's title inside the diff change (falls back to the raw case id).
 */
function mapsToLabel(finding: MaterialFinding): string {
  const cc = finding.change.after ?? finding.change.before;
  const matched =
    cc?.cases.find((c) => c.case_id === finding.case_id) ?? cc?.cases[0];
  return matched?.title ?? finding.case_id;
}

export default function ReportDetail({
  service,
  category,
  findings,
  feedback = {},
  reviewedLabel = "just now",
  truncationNotice = null,
  onFeedback,
  onSubmitFeedback,
  onBack,
  onDone,
}: ReportDetailProps) {
  const count = findings.length;

  // Per-point selections live locally, seeded from the `feedback` prop.
  const [stances, setStances] = useState<Record<string, FeedbackStance>>(feedback);

  function choose(caseId: string, stance: FeedbackStance) {
    setStances((prev) => ({ ...prev, [caseId]: stance }));
    onFeedback?.(caseId, stance);
  }

  function submit() {
    // Hand the parent ONLY the points the user actually chose (skip unset).
    const chosen: Record<string, FeedbackStance> = {};
    for (const [caseId, stance] of Object.entries(stances)) {
      if (stance === "care" || stance === "dont_care") chosen[caseId] = stance;
    }
    onSubmitFeedback?.(chosen);
  }

  return (
    <div className={styles.page}>
      {/* Top bar + tab nav are provided by the shared <AppShell> (Phase 7 Step A). */}

      {/* Header block */}
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Back
        </button>
        <h1 className={styles.title}>Here&apos;s what agreeing to {service} means</h1>
        <p className={styles.subtitle}>
          {count} {count === 1 ? "thing" : "things"} worth your attention in this{" "}
          {category} agreement.
        </p>
        <p className={styles.reviewed}>Reviewed {reviewedLabel}.</p>
      </div>

      {/* Truncation notice (only when the agreement was cut by the hard cap) */}
      {truncationNotice && (
        <div className={styles.truncation}>
          <span className={styles.truncationIcon} aria-hidden="true">
            ⚠
          </span>
          <span>{truncationNotice}</span>
        </div>
      )}

      {/* Findings */}
      <div className={styles.findings}>
        {findings.map((finding, i) => {
          const severity = SEVERITY[finding.classification];
          const stance = stances[finding.case_id];
          return (
            <div className={styles.card} key={`${finding.case_id}-${i}`}>
              <div
                className={styles.severity}
                style={{ background: severity.bg, color: severity.fg }}
              >
                <span
                  className={styles.severityDot}
                  style={{ background: severity.fg }}
                />
                {severity.label}
              </div>

              <h2 className={styles.cardTitle}>{finding.change.summary}</h2>
              <p className={styles.why}>{finding.reason}</p>

              <div className={styles.mapsTo}>
                <div className={styles.mapsToIcon}>§</div>
                <span className={styles.mapsToLabel}>
                  Maps to: {mapsToLabel(finding)}
                </span>
              </div>

              <div className={styles.feedback}>
                <span className={styles.feedbackLabel}>Your take:</span>
                <button
                  type="button"
                  className={`${styles.fbBtn} ${
                    stance === "care" ? styles.careSelected : styles.care
                  }`}
                  aria-pressed={stance === "care"}
                  onClick={() => choose(finding.case_id, "care")}
                >
                  This matters to me
                </button>
                <button
                  type="button"
                  className={`${styles.fbBtn} ${
                    stance === "dont_care" ? styles.dontMindSelected : styles.dontMind
                  }`}
                  aria-pressed={stance === "dont_care"}
                  onClick={() => choose(finding.case_id, "dont_care")}
                >
                  I don&apos;t mind this
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Closing */}
      <div className={styles.closing}>
        <p className={styles.closingText}>
          These are now being tracked for you — I&apos;ll tell you if anything changes.
        </p>
        <button type="button" className={styles.submitBtn} onClick={submit}>
          Save my answers
        </button>
        <button type="button" className={styles.closingBtn} onClick={onDone}>
          Back to agreement
        </button>
      </div>
    </div>
  );
}
