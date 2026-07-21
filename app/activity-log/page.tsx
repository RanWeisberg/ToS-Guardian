/**
 * app/activity-log/page.tsx — light-pass placeholder.
 *
 * Step A only stands the route up inside the shared shell. The real Activity Log
 * (full, filterable history of every agreement read and what the agent did,
 * PROJECT_SPEC.md §7) is built in a later step.
 */

import AppShell from "@/components/shell/AppShell";
import styles from "@/components/shell/AppShell.module.css";

export default function ActivityLogPage() {
  return (
    <AppShell>
      <div className={styles.placeholderWrap}>
        <h1 className={styles.placeholderTitle}>Activity Log</h1>
        <p className={styles.placeholderText}>
          Coming soon — a full, filterable history of every agreement the agent has
          reviewed and what it did.
        </p>
      </div>
    </AppShell>
  );
}
