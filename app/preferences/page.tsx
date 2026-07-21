/**
 * app/preferences/page.tsx — light-pass placeholder.
 *
 * Step A only stands the route up inside the shared shell. The real Preferences
 * editor (grouped by the 26 ToS;DR topics, cases nested, PROJECT_SPEC.md §7) is
 * built in a later step.
 */

import AppShell from "@/components/shell/AppShell";
import styles from "@/components/shell/AppShell.module.css";

export default function PreferencesPage() {
  return (
    <AppShell>
      <div className={styles.placeholderWrap}>
        <h1 className={styles.placeholderTitle}>Preferences</h1>
        <p className={styles.placeholderText}>
          Coming soon — tune what you care about, grouped by topic, and the agent will
          weigh future findings against it.
        </p>
      </div>
    </AppShell>
  );
}
