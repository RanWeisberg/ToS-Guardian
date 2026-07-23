"use client";

/**
 * components/preferences/PreferencesEditor.tsx — the answer-log view (step 4b).
 *
 * Two modes (the server page decides which):
 *   - "log":      a filterable list of the user's ANSWERED findings (Service ·
 *                 Category · Clause · Explanation · Your answer). Empty when none.
 *   - "deeplink": exactly the cases passed in (e.g. from Standing issues), at one
 *                 category, so a first-time stance can be set — answered rows show
 *                 their stance, unanswered show an unset toggle.
 *
 * Presentational + local state. The ONLY network call is savePreference(), which
 * writes the answer log via /api/preferences.
 */

import { useMemo, useState } from "react";
import type { Classification } from "@/lib/contracts";
import type { FeedbackStance } from "@/components/report-detail/ReportDetail";
import { savePreference } from "./savePreference";
import styles from "./PreferencesEditor.module.css";

/** One row the editor renders (log entry or a deep-linked case). */
export interface EditorRow {
  key: string;
  service: string;
  category: string;
  case_id: string;
  clause: string;
  explanation: string;
  classification: Classification | null;
  stance: FeedbackStance | null;
}

export interface PreferencesEditorProps {
  rows: EditorRow[];
  mode: "log" | "deeplink";
  deepLinkCategory?: string | null;
}

const ALL = "__all__";

/** Friendly severity label + tag class per classification. */
const SEVERITY: Record<Classification, { label: string; cls: string }> = {
  good: { label: "Looks fine", cls: styles.sevGood },
  neutral: { label: "Worth noting", cls: styles.sevNeutral },
  bad: { label: "Important", cls: styles.sevBad },
  blocker: { label: "Critical", cls: styles.sevBlocker },
};

function categoryLabel(category: string): string {
  return category === "*" ? "General default" : category;
}

export default function PreferencesEditor({ rows, mode, deepLinkCategory }: PreferencesEditorProps) {
  // Live copy so a toggle reflects immediately after a successful save.
  const [liveRows, setLiveRows] = useState<EditorRow[]>(rows);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Log-mode filters.
  const [serviceFilter, setServiceFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [stanceFilter, setStanceFilter] = useState<string>(ALL);

  const services = useMemo(
    () => [...new Set(liveRows.map((r) => r.service))].sort((a, b) => a.localeCompare(b)),
    [liveRows],
  );
  const categories = useMemo(
    () => [...new Set(liveRows.map((r) => r.category))].sort((a, b) => a.localeCompare(b)),
    [liveRows],
  );

  const visibleRows = useMemo(() => {
    if (mode === "deeplink") return liveRows;
    return liveRows.filter(
      (r) =>
        (serviceFilter === ALL || r.service === serviceFilter) &&
        (categoryFilter === ALL || r.category === categoryFilter) &&
        (stanceFilter === ALL || r.stance === stanceFilter),
    );
  }, [liveRows, mode, serviceFilter, categoryFilter, stanceFilter]);

  async function choose(row: EditorRow, stance: FeedbackStance) {
    setSavingKey(row.key);
    setRowErrors((e) => {
      const { [row.key]: _drop, ...rest } = e;
      void _drop;
      return rest;
    });
    try {
      const result = await savePreference(
        row.case_id,
        row.category,
        stance,
        row.clause,
        row.explanation,
      );
      if (result.ok) {
        setLiveRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, stance } : r)),
        );
      } else {
        setRowErrors((e) => ({
          ...e,
          [row.key]: result.error ?? "Couldn't save that — please try again.",
        }));
      }
    } catch {
      setRowErrors((e) => ({
        ...e,
        [row.key]: "Couldn't reach the server — please try again.",
      }));
    } finally {
      setSavingKey(null);
    }
  }

  const isDeepLink = mode === "deeplink";

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Preferences</h1>
        <p className={styles.subtitle}>
          Your decisions on the clauses I&apos;ve shown you. Adjust any of them and
          I&apos;ll weigh future findings accordingly.
        </p>
      </div>

      {/* Deep-link banner */}
      {isDeepLink && (
        <div className={styles.filterNotice}>
          <span>
            Adjust {liveRows.length} {liveRows.length === 1 ? "case" : "cases"} for{" "}
            {categoryLabel(deepLinkCategory ?? "*")}
          </span>
          <a className={styles.filterClear} href="/preferences">
            Clear
          </a>
        </div>
      )}

      {/* Log-mode filters */}
      {!isDeepLink && liveRows.length > 0 && (
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
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value={ALL}>All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={stanceFilter}
            onChange={(e) => setStanceFilter(e.target.value)}
            aria-label="Filter by answer"
          >
            <option value={ALL}>Any answer</option>
            <option value="care">I care</option>
            <option value="dont_care">I don&apos;t mind</option>
          </select>
        </div>
      )}

      {/* Empty states */}
      {liveRows.length === 0 ? (
        <div className={styles.empty}>
          No answers yet — as you respond to reports, your decisions show up here.
        </div>
      ) : visibleRows.length === 0 ? (
        <div className={styles.empty}>No answers match these filters.</div>
      ) : (
        <div className={styles.logCard}>
          {visibleRows.map((row) => {
            const sev = row.classification ? SEVERITY[row.classification] : null;
            const saving = savingKey === row.key;
            const err = rowErrors[row.key];
            return (
              <div key={row.key} className={styles.logRow}>
                <div className={styles.logMain}>
                  <p className={styles.logClause}>{row.clause}</p>
                  {row.explanation && (
                    <p className={styles.logExplanation}>{row.explanation}</p>
                  )}
                  <span className={styles.logMeta}>
                    {sev && <span className={`${styles.sevTag} ${sev.cls}`}>{sev.label}</span>}
                    <span className={styles.metaText}>
                      {row.service} · {categoryLabel(row.category)}
                    </span>
                  </span>
                  {err && <p className={styles.rowError}>{err}</p>}
                </div>

                <div className={styles.toggle}>
                  <button
                    type="button"
                    disabled={saving}
                    aria-pressed={row.stance === "care"}
                    className={`${styles.tgBtn} ${row.stance === "care" ? styles.careSel : styles.care}`}
                    onClick={() => choose(row, "care")}
                  >
                    I care
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    aria-pressed={row.stance === "dont_care"}
                    className={`${styles.tgBtn} ${row.stance === "dont_care" ? styles.dontSel : styles.dont}`}
                    onClick={() => choose(row, "dont_care")}
                  >
                    I don&apos;t mind
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}