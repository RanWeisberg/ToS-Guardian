"use client";

/**
 * components/preferences/PreferencesEditor.tsx
 *
 * The Preferences tab (PROJECT_SPEC.md §7): tune what you care about, per service
 * category, grouped by ToS;DR topic (collapsible, never a flat list). The server
 * page loads the taxonomy + all preference rows + the real categories and passes
 * them here; this component is presentational with local state. The ONLY network
 * call is savePreference() when a stance is toggled.
 *
 * Stance resolution for the selected category: the (case, selectedCategory) row
 * wins; else the (case, "*") general row; else the ToS;DR classification default
 * (blocker/bad → care, else dont_care — same rule as scripts/seed_preferences.py).
 * A row set exactly at the selected category is shown as "Set"; otherwise
 * "Inherited".
 */

import { useMemo, useState } from "react";
import type { Classification } from "@/lib/contracts";
import type { Preference } from "@/lib/db";
import type { FeedbackStance } from "@/components/report-detail/ReportDetail";
import { savePreference } from "./savePreference";
import styles from "./PreferencesEditor.module.css";

/** Trimmed case metadata the editor needs (case_id normalized to string). */
export interface EditorCase {
  case_id: string;
  title: string;
  classification: Classification;
  topic_name: string;
}

export interface PreferencesEditorProps {
  cases: EditorCase[];
  preferences: Preference[];
  categories: string[];
  /** Initial selected category from ?category=, or "*" (general default). */
  initialCategory: string;
  /** Initial case-id filter from ?cases=, or null for the full list. */
  initialCaseFilter: string[] | null;
}

const GENERAL = "*";
const OTHER_TOPIC = "Other";

/** ToS;DR classification → default stance (mirrors seed_preferences.py). */
const CARE_CLASSIFICATIONS: ReadonlySet<Classification> = new Set(["bad", "blocker"]);
function defaultStance(classification: Classification): FeedbackStance {
  return CARE_CLASSIFICATIONS.has(classification) ? "care" : "dont_care";
}

/** Friendly severity label + tag class per classification. */
const SEVERITY: Record<Classification, { label: string; cls: string }> = {
  good: { label: "Looks fine", cls: styles.sevGood },
  neutral: { label: "Worth noting", cls: styles.sevNeutral },
  bad: { label: "Important", cls: styles.sevBad },
  blocker: { label: "Critical", cls: styles.sevBlocker },
};

function categoryLabel(category: string): string {
  return category === GENERAL ? "General default" : category;
}

function prefKey(caseId: string, category: string): string {
  return `${caseId}|${category}`;
}

export default function PreferencesEditor({
  cases,
  preferences,
  categories,
  initialCategory,
  initialCaseFilter,
}: PreferencesEditorProps) {
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);

  // Live copy of preference rows, keyed by `${case_id}|${category}`. Seeded from
  // props; updated on each successful save so a row flips to "Set" immediately.
  const [prefs, setPrefs] = useState<Map<string, Preference["stance"]>>(() => {
    const m = new Map<string, Preference["stance"]>();
    for (const p of preferences) m.set(prefKey(p.case_id, p.category), p.stance);
    return m;
  });

  // The case-id filter (from ?cases=). Local so "clear" returns to the full list.
  const [caseFilter, setCaseFilter] = useState<Set<string> | null>(
    initialCaseFilter && initialCaseFilter.length > 0
      ? new Set(initialCaseFilter)
      : null,
  );

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Group the (optionally filtered) cases by topic, sorted; "Other" last.
  const groups = useMemo(() => {
    const visible = caseFilter
      ? cases.filter((c) => caseFilter.has(c.case_id))
      : cases;
    const byTopic = new Map<string, EditorCase[]>();
    for (const c of visible) {
      const topic = c.topic_name?.trim() || OTHER_TOPIC;
      const arr = byTopic.get(topic);
      if (arr) arr.push(c);
      else byTopic.set(topic, [c]);
    }
    const sorted = [...byTopic.entries()].sort((a, b) => {
      if (a[0] === OTHER_TOPIC) return 1;
      if (b[0] === OTHER_TOPIC) return -1;
      return a[0].localeCompare(b[0]);
    });
    for (const [, arr] of sorted) arr.sort((x, y) => x.title.localeCompare(y.title));
    return sorted;
  }, [cases, caseFilter]);

  // Topics collapsed by default; a filter auto-expands the topics it touches.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialCaseFilter && initialCaseFilter.length > 0
      ? new Set(
          cases
            .filter((c) => initialCaseFilter.includes(c.case_id))
            .map((c) => c.topic_name?.trim() || OTHER_TOPIC),
        )
      : new Set(),
  );

  function toggleTopic(topic: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  }

  /** Resolve a case's stance for the selected category + whether it's set here. */
  function resolve(c: EditorCase): { stance: FeedbackStance; isSet: boolean } {
    const exact = prefs.get(prefKey(c.case_id, selectedCategory));
    if (exact) return { stance: exact, isSet: true };
    if (selectedCategory !== GENERAL) {
      const general = prefs.get(prefKey(c.case_id, GENERAL));
      if (general) return { stance: general, isSet: false };
    }
    return { stance: defaultStance(c.classification), isSet: false };
  }

  async function choose(c: EditorCase, stance: FeedbackStance) {
    const key = prefKey(c.case_id, selectedCategory);
    setSavingKey(key);
    setRowErrors((e) => {
      const { [c.case_id]: _drop, ...rest } = e;
      void _drop;
      return rest;
    });
    try {
      const result = await savePreference(c.case_id, selectedCategory, stance);
      if (result.ok) {
        // Now set for this category → reflect immediately.
        setPrefs((prev) => new Map(prev).set(key, stance));
      } else {
        setRowErrors((e) => ({
          ...e,
          [c.case_id]: result.error ?? "Couldn't save that — please try again.",
        }));
      }
    } catch {
      setRowErrors((e) => ({
        ...e,
        [c.case_id]: "Couldn't reach the server — please try again.",
      }));
    } finally {
      setSavingKey(null);
    }
  }

  const filteredCount = caseFilter
    ? cases.filter((c) => caseFilter.has(c.case_id)).length
    : 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Preferences</h1>
        <p className={styles.subtitle}>
          Tell me what you care about. I&apos;ll weigh future findings against it —
          set a global default, or fine-tune per service category.
        </p>
      </div>

      {/* Category selector */}
      <div className={styles.toolbar}>
        <label className={styles.toolbarLabel} htmlFor="pref-category">
          Editing
        </label>
        <select
          id="pref-category"
          className={styles.select}
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value={GENERAL}>General default</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Filter notice */}
      {caseFilter && (
        <div className={styles.filterNotice}>
          <span>
            Showing {filteredCount} {filteredCount === 1 ? "case" : "cases"} for{" "}
            {categoryLabel(selectedCategory)}
          </span>
          <button
            type="button"
            className={styles.filterClear}
            onClick={() => setCaseFilter(null)}
          >
            Clear
          </button>
        </div>
      )}

      {/* Collapsible topic groups */}
      {groups.length === 0 ? (
        <div className={styles.empty}>No cases to show.</div>
      ) : (
        <div className={styles.groups}>
          {groups.map(([topic, topicCases]) => {
            const open = expanded.has(topic);
            return (
              <div key={topic} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHeader}
                  onClick={() => toggleTopic(topic)}
                  aria-expanded={open}
                >
                  <span className={styles.groupHeadLeft}>
                    <span className={styles.groupName}>{topic}</span>
                    <span className={styles.groupCount}>
                      {topicCases.length} {topicCases.length === 1 ? "case" : "cases"}
                    </span>
                  </span>
                  <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
                </button>

                {open && (
                  <div className={styles.groupBody}>
                    {topicCases.map((c) => {
                      const { stance, isSet } = resolve(c);
                      const sev = SEVERITY[c.classification];
                      const key = prefKey(c.case_id, selectedCategory);
                      const saving = savingKey === key;
                      const err = rowErrors[c.case_id];
                      return (
                        <div key={c.case_id} className={styles.caseRow}>
                          <div className={styles.caseMain}>
                            <p className={styles.caseTitle}>{c.title}</p>
                            <span className={styles.caseTags}>
                              <span className={`${styles.sevTag} ${sev.cls}`}>
                                {sev.label}
                              </span>
                              {isSet ? (
                                <span className={`${styles.statusChip} ${styles.statusSet}`}>
                                  <span className={styles.statusSetDot} />
                                  Set for {categoryLabel(selectedCategory)}
                                </span>
                              ) : (
                                <span
                                  className={`${styles.statusChip} ${styles.statusInherited}`}
                                >
                                  Inherited
                                </span>
                              )}
                            </span>
                            {err && <p className={styles.rowError}>{err}</p>}
                          </div>

                          <div className={styles.toggle}>
                            <button
                              type="button"
                              disabled={saving}
                              aria-pressed={stance === "care"}
                              className={`${styles.tgBtn} ${
                                stance === "care" ? styles.careSel : styles.care
                              }`}
                              onClick={() => choose(c, "care")}
                            >
                              I care
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              aria-pressed={stance === "dont_care"}
                              className={`${styles.tgBtn} ${
                                stance === "dont_care" ? styles.dontSel : styles.dont
                              }`}
                              onClick={() => choose(c, "dont_care")}
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
          })}
        </div>
      )}
    </div>
  );
}