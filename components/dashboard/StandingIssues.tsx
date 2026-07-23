"use client";

/**
 * components/dashboard/StandingIssues.tsx — the Dashboard's "Standing issues"
 * section, collapsible per service.
 *
 * Fed the `computeStandingIssues()` result as a prop (the dashboard page stays a
 * server component and owns the query — no data-flow change here). All cards start
 * COLLAPSED. A card's header (a <button>) toggles expand/collapse and shows the
 * service, category, and a severity-count summary. The expanded body reveals the
 * full clause list plus the "Adjust in Preferences →" deep-link — the ONLY
 * navigating element, so toggling never navigates away.
 */

import { useState } from "react";
import Link from "next/link";
import type { Classification } from "@/lib/contracts";
import type { StandingIssueService } from "@/lib/db";
import dash from "./Dashboard.module.css";
import styles from "./StandingIssues.module.css";

/** Friendly severity label + tag class per classification (only bad/blocker can
 *  ever surface as a standing issue; good/neutral are mapped for totality). */
const ISSUE_TAG: Record<Classification, { label: string; cls: string }> = {
  good: { label: "Looks fine", cls: dash.tagBad },
  neutral: { label: "Worth noting", cls: dash.tagBad },
  bad: { label: "Important", cls: dash.tagBad },
  blocker: { label: "Critical", cls: dash.tagBlocker },
};

/** Severity display order for the collapsed summary (most severe first). */
const SEVERITY_ORDER: Classification[] = ["blocker", "bad", "neutral", "good"];

/** "2 Critical · 5 Important" — non-zero severity buckets, most severe first. */
function severitySummary(issues: StandingIssueService["issues"]): string {
  const counts = new Map<Classification, number>();
  for (const issue of issues) {
    counts.set(issue.classification, (counts.get(issue.classification) ?? 0) + 1);
  }
  return SEVERITY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0)
    .map((c) => `${counts.get(c)} ${ISSUE_TAG[c].label}`)
    .join(" · ");
}

export default function StandingIssues({ issues }: { issues: StandingIssueService[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(service: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });
  }

  if (issues.length === 0) {
    return (
      <div className={dash.emptyMini}>
        No standing issues — nothing you&apos;ve flagged is currently a problem.
      </div>
    );
  }

  return (
    <div className={dash.list}>
      {issues.map((s) => {
        const open = expanded.has(s.service);
        // Deep-link into the Preferences hub: preselect this service's category
        // and filter to exactly its problematic cases.
        const caseIds = s.issues
          .map((issue) => encodeURIComponent(issue.case_id))
          .join(",");
        const href = `/preferences?category=${encodeURIComponent(s.category)}&cases=${caseIds}`;

        return (
          <div key={s.service} className={dash.staticCard}>
            <button
              type="button"
              className={styles.header}
              onClick={() => toggle(s.service)}
              aria-expanded={open}
            >
              <span className={styles.headMain}>
                <span className={dash.service}>{s.service}</span>
                <span className={styles.headCategory}>{s.category}</span>
                <span className={styles.summary}>{severitySummary(s.issues)}</span>
              </span>
              <span
                className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
                aria-hidden="true"
              />
            </button>

            {open && (
              <div className={styles.body}>
                <ul className={dash.issueList}>
                  {s.issues.map((issue) => {
                    const tag = ISSUE_TAG[issue.classification];
                    return (
                      <li key={issue.case_id} className={dash.issueRow}>
                        <span className={`${dash.issueTag} ${tag.cls}`}>{tag.label}</span>
                        <span className={dash.issueTitle}>{issue.title}</span>
                      </li>
                    );
                  })}
                </ul>
                <Link href={href} className={styles.adjust}>
                  Adjust in Preferences →
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}