/**
 * app/dashboard/page.tsx — light-pass placeholder.
 *
 * Step A only stands the route up inside the shared shell. The real Dashboard
 * (pending reports → standing issues → recent activity → subscribed services,
 * PROJECT_SPEC.md §7) is built in a later step.
 */

import AppShell from "@/components/shell/AppShell";
import styles from "@/components/shell/AppShell.module.css";

export default function DashboardPage() {
  return (
    <AppShell>
      <div className={styles.placeholderWrap}>
        <h1 className={styles.placeholderTitle}>Dashboard</h1>
        <p className={styles.placeholderText}>
          Coming soon — your pending reports, standing issues, recent activity, and
          subscribed services will live here.
        </p>
      </div>
    </AppShell>
  );
}
