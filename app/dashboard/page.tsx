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
 * + the answer log with NO LLM call. Single-column throughout.
 */

import Link from "next/link";
import {
  listPendingReports,
  getReportAnswerRows,
  computeStandingIssues,
  listRecentReports,
  listServicesWithIssueCounts,
} from "@/lib/db";
import type { ReportStatus } from "@/lib/db";
import AppShell from "@/components/shell/AppShell";
import StandingIssues from "@/components/dashboard/StandingIssues";
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
    listServicesWithIssueCounts(),
  ]);
  // Dashboard shows only the top 5 (already sorted newest-review-first); the full
  // list + unsubscribe live on the Services tab.
  const topServices = services.slice(0, 5);

  // Answered progress per pending report, from THAT report's own answer rows.
  // (Legacy/pre-migration reports with no answer rows → all points unanswered.)
  const progress = await Promise.all(
    reports.map(async (report) => {
      const rows = await getReportAnswerRows(report.id);
      const answeredCaseIds = new Set(
        rows.filter((r) => r.answered).map((r) => r.case_id),
      );
      const total = report.points.length;
      const answeredCount = report.points.filter((p) =>
        answeredCaseIds.has(p.case_id),
      ).length;
      return { answeredCount, total };
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
              <Link href="/" className={styles.emptyBtn}>
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

        {/* 2. Standing issues (collapsible per service) */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Standing issues</h2>
          <StandingIssues issues={standingIssues} />
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
            <>
              <div className={styles.list}>
                {topServices.map((s) => (
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
                      <span
                        className={
                          s.issueCount > 0 ? styles.svcIssuesOpen : styles.svcIssuesClear
                        }
                      >
                        {s.issueCount > 0
                          ? `${s.issueCount} ${s.issueCount === 1 ? "issue" : "issues"}`
                          : "No issues"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/services" className={styles.seeAll}>
                See all services →
              </Link>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}