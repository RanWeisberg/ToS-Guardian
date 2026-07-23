"use client";

/**
 * components/activity-log/ActivityLog.tsx — the Activity Log tab's client list.
 *
 * A single-column chronological history of every agreement the agent reviewed and
 * what it did. Reported entries link to their report; "nothing flagged" entries
 * are static. Simple client-side filters (by service, by status) over the entries
 * the server page passed in. Presentational + local state; no network calls.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./ActivityLog.module.css";

/** One row, preformatted for display by the server page. */
export interface ActivityItem {
  service: string;
  category: string;
  version: number;
  reportId: string | null;
  status: "reported" | "silent";
  /** Preformatted date/time (formatted server-side to avoid hydration drift). */
  when: string;
}

const ALL = "__all__";

export default function ActivityLog({ items }: { items: ActivityItem[] }) {
  const [serviceFilter, setServiceFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const services = useMemo(
    () => [...new Set(items.map((i) => i.service))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (serviceFilter === ALL || i.service === serviceFilter) &&
          (statusFilter === ALL || i.status === statusFilter),
      ),
    [items, serviceFilter, statusFilter],
  );

  if (items.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.header}>
          <h1 className={styles.title}>Activity Log</h1>
          <p className={styles.subtitle}>Every agreement I&apos;ve reviewed and what I did.</p>
        </div>
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>No activity yet.</h2>
          <p className={styles.emptyText}>
            Reviewed agreements will show up here — add your first service to get started.
          </p>
          <Link href="/add-agreement" className={styles.emptyBtn}>
            Add your first service
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Activity Log</h1>
        <p className={styles.subtitle}>Every agreement I&apos;ve reviewed and what I did.</p>
      </div>

      <div className={styles.filters}>
        <select
          className={styles.select}
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          aria-label="Filter by service"
        >
          <option value={ALL}>All services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value={ALL}>All activity</option>
          <option value="reported">Reported</option>
          <option value="silent">Nothing flagged</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className={styles.emptyMini}>No activity matches these filters.</div>
      ) : (
        <div className={styles.list}>
          {visible.map((item, i) => {
            const reported = item.status === "reported" && item.reportId;
            const body = (
              <>
                <div className={styles.cardTop}>
                  <h2 className={styles.service}>{item.service}</h2>
                  <span
                    className={`${styles.statusPill} ${
                      reported ? styles.statusReported : styles.statusSilent
                    }`}
                  >
                    <span className={styles.statusDot} />
                    {reported ? "Reported" : "Nothing flagged"}
                  </span>
                </div>
                <p className={styles.category}>{item.category}</p>
                <div className={styles.cardFoot}>
                  <span className={styles.when}>
                    <span className={styles.whenDot} />
                    {item.when}
                    <span className={styles.versionTag}>v{item.version}</span>
                  </span>
                  {reported && <span className={styles.viewReport}>View report →</span>}
                </div>
              </>
            );

            return reported ? (
              <Link
                key={`${item.service}-${item.version}-${i}`}
                href={`/report/${item.reportId}`}
                className={`${styles.card} ${styles.cardLink}`}
              >
                {body}
              </Link>
            ) : (
              <div key={`${item.service}-${item.version}-${i}`} className={styles.card}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}