"use client";

/**
 * components/services/ServicesList.tsx — the Services tab's client list.
 *
 * Renders a single-column list of tracked services (name, category, last-reviewed
 * date, latest version, standing-issue count) with a "Stop tracking" action per
 * row. Stopping opens an in-design confirm dialog (no browser confirm()); on
 * confirm it calls unsubscribeService and optimistically removes the row.
 *
 * Presentational + local state. The only network call is unsubscribeService().
 */

import { useState } from "react";
import Link from "next/link";
import { unsubscribeService } from "./unsubscribeService";
import styles from "./Services.module.css";

/** One tracked service, preformatted for display by the server page. */
export interface ServiceRow {
  service: string;
  category: string;
  latestVersion: number;
  issueCount: number;
  /** Preformatted "last reviewed" date (formatted server-side to avoid drift). */
  reviewed: string;
}

export default function ServicesList({ services }: { services: ServiceRow[] }) {
  const [rows, setRows] = useState<ServiceRow[]>(services);
  const [confirming, setConfirming] = useState<ServiceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openConfirm(row: ServiceRow) {
    setError(null);
    setConfirming(row);
  }

  function closeConfirm() {
    if (busy) return;
    setConfirming(null);
    setError(null);
  }

  async function confirmStop() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      const result = await unsubscribeService(confirming.service);
      if (result.ok) {
        // Optimistic: drop the row so it disappears immediately.
        setRows((prev) => prev.filter((r) => r.service !== confirming.service));
        setConfirming(null);
      } else {
        setError(result.error ?? "Couldn't stop tracking that — please try again.");
      }
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.header}>
          <h1 className={styles.title}>Services</h1>
          <p className={styles.subtitle}>The services ToS Guardian is tracking for you.</p>
        </div>
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>You&apos;re not tracking any services yet.</h2>
          <p className={styles.emptyText}>
            Add your first service to start watching its terms.
          </p>
          <Link href="/" className={styles.emptyBtn}>
            Add your first service
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Services</h1>
        <p className={styles.subtitle}>
          The services ToS Guardian is tracking for you. Stop tracking any you&apos;ve
          left — it&apos;ll come back if a new agreement arrives.
        </p>
      </div>

      <div className={styles.list}>
        {rows.map((row) => {
          const hasIssues = row.issueCount > 0;
          return (
            <div key={row.service} className={styles.card}>
              <div className={styles.cardTop}>
                <h2 className={styles.service}>{row.service}</h2>
                <span
                  className={`${styles.issuePill} ${
                    hasIssues ? styles.issuePillOpen : styles.issuePillClear
                  }`}
                >
                  <span className={styles.issueDot} />
                  {hasIssues
                    ? `${row.issueCount} ${row.issueCount === 1 ? "issue" : "issues"}`
                    : "No issues"}
                </span>
              </div>
              <p className={styles.category}>{row.category}</p>

              <div className={styles.cardFoot}>
                <span className={styles.meta}>
                  <span className={styles.metaDot} />
                  Last reviewed {row.reviewed}
                  <span className={styles.versionTag}>v{row.latestVersion}</span>
                </span>
                <button
                  type="button"
                  className={styles.stopBtn}
                  onClick={() => openConfirm(row)}
                >
                  Stop tracking
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirming && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          onClick={closeConfirm}
        >
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>Stop tracking {confirming.service}?</h3>
            <p className={styles.dialogText}>
              It&apos;ll come back if a new agreement arrives.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogCancel}
                onClick={closeConfirm}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                onClick={confirmStop}
                disabled={busy}
              >
                {busy ? "Stopping…" : "Stop tracking"}
              </button>
            </div>
            {error && <p className={styles.dialogError}>{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}