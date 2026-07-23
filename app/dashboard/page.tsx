/**
 * app/dashboard/page.tsx — the full Dashboard (PROJECT_SPEC.md §7).
 *
 * Four stacked sections in triage priority order:
 *   1. Pending reports    — the inbox front door (link into /report/[id]).
 *   2. Standing issues     — problematic cared-about cases still in your terms.
 *   3. Recent activity     — the agent's latest agreement reviews.
 *   4. Subscribed services — the services tracked in the version store.
 *
 * Server component (dynamic — reads live Supabase state each request). All four
 * datasets are read-only; standing issues are DERIVED from stored classifications
 * + preferences with NO LLM call. Single-column throughout.
 */

import Link from "next/link";
import {
  listPendingReports,
  getSavedStances,
  computeStandingIssues,
  listRecentReports,
  listActiveServices,
} from "@/lib/db";
import type { Classification } from "@/lib/contracts";
import type { ReportStatus } from "@/lib/db";
import AppShell from "@/components/shell/AppShell";
import styles from "@/components/dashboard/Dashboard.module.css";

export const dynamic = "force-dynamic";

/** Human-readable timestamp (date + time), rendered once on the server. */
function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Human-readable date only (for the table's "Added" column). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Friendly severity label + tag class per classification (only bad/blocker can
 *  ever surface as a standing issue; good/neutral are mapped for totality). */
const ISSUE_TAG: Record<Classification, { label: string; cls: string }> = {
  good: { label: "Looks fine", cls: styles.tagBad },
  neutral: { label: "Worth noting", cls: styles.tagBad },
  bad: { label: "Important", cls: styles.tagBad },
  blocker: { label: "Critical", cls: styles.tagBlocker },
};

/** Report status → recent-activity label + pill class. */
const STATUS_PILL: Record<ReportStatus, { label: string; cls: string }> = {
  pending: { label: "Waiting for you", cls: styles.statusWaiting },
  answered: { label: "Answered", cls: styles.statusAnswered },
};

export default async function DashboardPage() {
  const [reports, standingIssues, recent, services] = await Promise.all([
    listPendingReports(),
    computeStandingIssues(),
    listRecentReports(),
    listActiveServices(),
  ]);

  // Answered progress per pending report, from the saved user preferences.
  const progress = await Promise.all(
    reports.map(async (report) => {
      const caseIds = report.points.map((p) => p.case_id);
      const saved = await getSavedStances(caseIds, report.category);
      const answeredCount = caseIds.filter((id) => id in saved).length;
      return { answeredCount, total: caseIds.length };
    }),
  );

  return (
    <AppShell>
      <div className={styles.wrap}>
        <div className={styles.header}>
          <h1 className={styles.title}>Your dashboard</h1>
          <p className={styles.subtitle}>
            Everything ToS Guardian is watching for you, most important first.
          </p>
        </div>

        {/* 1. Pending reports */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Reports waiting for you</h2>
          {reports.length === 0 ? (
            <div className={styles.empty}>
              <h3 className={styles.emptyTitle}>No reports waiting.</h3>
              <p className={styles.emptyText}>
                Add your first service to get started — paste an agreement and
                I&apos;ll tell you what matters.
              </p>
              <Link href="/add-agreement" className={styles.emptyBtn}>
                Add your first service
              </Link>
            </div>
          ) : (
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>Service</span>
                <span>Findings</span>
                <span>Unanswered</span>
                <span>Added</span>
              </div>
              {reports.map((report, i) => {
                const { answeredCount, total } = progress[i];
                const unanswered = total - answeredCount;
                return (
                  <Link
                    key={report.id}
                    href={`/report/${report.id}`}
                    className={styles.tableRow}
                  >
                    <span className={styles.tdService}>{report.service}</span>
                    <span className={styles.tdNum}>{total}</span>
                    <span
                      className={`${styles.tdNum} ${
                        unanswered > 0 ? styles.tdUnansweredOpen : styles.tdUnansweredDone
                      }`}
                    >
                      {unanswered}
                    </span>
                    <span className={styles.tdAdded}>{formatDate(report.created_at)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* 2. Standing issues */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Standing issues</h2>
          {standingIssues.length === 0 ? (
            <div className={styles.emptyMini}>
              No standing issues — nothing you&apos;ve flagged is currently a problem.
            </div>
          ) : (
            <div className={styles.list}>
              {standingIssues.map((s) => {
                // Deep-link into the Preferences hub: preselect this service's
                // category and filter to exactly its problematic cases.
                const caseIds = s.issues
                  .map((issue) => encodeURIComponent(issue.case_id))
                  .join(",");
                const href = `/preferences?category=${encodeURIComponent(s.category)}&cases=${caseIds}`;
                return (
                  <Link key={s.service} href={href} className={styles.card}>
                    <div className={styles.cardTop}>
                      <h3 className={styles.service}>{s.service}</h3>
                      <span className={styles.tuneHint}>Adjust in Preferences →</span>
                    </div>
                    <p className={styles.category}>{s.category}</p>
                    <ul className={styles.issueList}>
                      {s.issues.map((issue) => {
                        const tag = ISSUE_TAG[issue.classification];
                        return (
                          <li key={issue.case_id} className={styles.issueRow}>
                            <span className={`${styles.issueTag} ${tag.cls}`}>
                              {tag.label}
                            </span>
                            <span className={styles.issueTitle}>{issue.title}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* 3. Recent activity */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Recent activity</h2>
          {recent.length === 0 ? (
            <div className={styles.emptyMini}>No activity yet.</div>
          ) : (
            <div className={styles.activityCard}>
              {recent.map((a) => {
                const status = STATUS_PILL[a.status];
                return (
                  <Link
                    key={a.id}
                    href={`/report/${a.id}`}
                    className={styles.activityRow}
                  >
                    <span className={styles.activityText}>
                      <strong>{a.service}</strong>
                      <span className={`${styles.statusPill} ${status.cls}`}>
                        {status.label}
                      </span>
                    </span>
                    <span className={styles.activityTime}>
                      {formatTimestamp(a.created_at)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* 4. Subscribed services */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Subscribed services</h2>
          {services.length === 0 ? (
            <div className={styles.emptyMini}>You&apos;re not tracking any services yet.</div>
          ) : (
            <div className={styles.list}>
              {services.map((s) => (
                <div key={s.service} className={styles.staticCard}>
                  <div className={styles.cardTop}>
                    <h3 className={styles.service}>{s.service}</h3>
                    <span className={styles.versionTag}>v{s.latestVersion}</span>
                  </div>
                  <p className={styles.category}>{s.category}</p>
                  <div className={styles.cardFoot}>
                    <span className={styles.progress}>
                      <span className={styles.progressDot} />
                      Last reviewed {formatTimestamp(s.lastReviewedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}