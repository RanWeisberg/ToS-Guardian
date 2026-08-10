"use client";

/**
 * components/shell/AppShell.tsx — the shared app chrome.
 *
 * Renders the top bar (ToS Guardian wordmark, a "Check mail" button + "Ready"
 * pill) and the five-tab nav band, then the page content below it. The tabs are
 * real links; the active tab is derived from the current route (usePathname).
 *
 * "Check mail" is TWO-PHASE (mail-checking is button-only — there is no cron):
 *   phase 1 "peeking"    → POST /api/mail_peek: a FREE read (how many new emails?),
 *                          no agent, zero tokens, marks nothing.
 *   phase 2 "processing" → only when the peek found mail: POST /api/mail_check,
 *                          which runs the agent and persists reports.
 * The middle "Found N new agreements — analyzing…" state gives the user a genuine
 * signal instead of one long grey button. On success a soft banner spans the app
 * and router.refresh() re-renders the current page so new reports appear.
 * These two mail calls are the ONLY network calls here; AppShell is otherwise chrome.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "./AppShell.module.css";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/preferences", label: "Preferences" },
  { href: "/activity-log", label: "Activity Log" },
  { href: "/services", label: "Services" },
  { href: "/", label: "Add agreement" },
] as const;

/** The header button's flow: idle → peeking (free) → processing (agent) → idle. */
type Phase = "idle" | "peeking" | "processing";

/** The subset of /api/mail_peek the button reads (phase 1). */
interface MailPeekResponse {
  status: "ok" | "error";
  error: string | null;
  count: number;
}

/** The subset of /api/mail_check the button reads (phase 2). */
interface MailCheckResponse {
  status: "ok" | "error";
  error: string | null;
  checked: number;
  processed: number;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ count: number } | null>(null);
  const [noNew, setNoNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "No new mail" is a transient micro-note — auto-clear after ~4s.
  useEffect(() => {
    if (!noNew) return;
    const t = setTimeout(() => setNoNew(false), 4000);
    return () => clearTimeout(t);
  }, [noNew]);

  async function checkMail() {
    setError(null);
    setNoNew(false);
    setPhase("peeking");
    try {
      // --- Phase 1: FREE peek — how many new emails? No agent, no tokens. ---
      let peekCount = 0;
      try {
        const res = await fetch("/api/mail_peek", { method: "POST" });
        const data = (await res.json()) as MailPeekResponse;
        if (data.status !== "ok") {
          setError("Couldn't check mail — try again");
          return;
        }
        peekCount = data.count;
      } catch {
        setError("Couldn't check mail — try again");
        return;
      }

      // Empty inbox → done, zero tokens spent.
      if (peekCount === 0) {
        setNoNew(true);
        return;
      }

      // --- Phase 2: found new mail → run the agent (this spends tokens). ---
      setFoundCount(peekCount);
      setPhase("processing");
      try {
        const res = await fetch("/api/mail_check", { method: "POST" });
        const data = (await res.json()) as MailCheckResponse;
        if (data.status === "ok") {
          // Use the ACTUAL processed count (may differ from the peek if mail
          // arrived between phases, or if some runs were silent).
          if (data.processed > 0) setBanner({ count: data.processed });
          else setNoNew(true);
          router.refresh();
        } else {
          setError("Couldn't finish processing — try again");
        }
      } catch {
        setError("Couldn't finish processing — try again");
      }
    } finally {
      // Never leave the button stuck.
      setPhase("idle");
      setFoundCount(null);
    }
  }

  const busy = phase !== "idle";
  const buttonLabel =
    phase === "peeking" ? "Checking…" : phase === "processing" ? "Analyzing…" : "Check mail";

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.bar}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG
                gains nothing from next/image, and a plain <img> keeps the flex row
                intact. alt="" is deliberate: the adjacent wordmark names the brand. */}
            <img className={styles.logo} src="/logo.svg" alt="" />
            <span className={styles.brandName}>ToS Guardian</span>
          </div>

          <div className={styles.actions}>
            {phase === "processing" && foundCount !== null && (
              <span className={styles.processingPill}>
                Found {foundCount} new agreement{foundCount === 1 ? "" : "s"} — analyzing…
              </span>
            )}
            {noNew && <span className={styles.microNote}>No new mail</span>}
            {error && <span className={styles.errorNote}>{error}</span>}
            <button
              type="button"
              className={styles.checkBtn}
              onClick={checkMail}
              disabled={busy}
            >
              {buttonLabel}
            </button>
            <div className={styles.status}>
              <span className={styles.statusDot} />
              <span className={styles.statusLabel}>Ready</span>
            </div>
          </div>
        </div>

        <nav className={styles.tabs}>
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`${styles.tab} ${active ? styles.tabActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {banner && (
        <div className={styles.bannerWrap}>
          <div className={styles.banner}>
            <span className={styles.bannerText}>
              {banner.count} new report{banner.count === 1 ? "" : "s"} from your inbox
            </span>
            <span className={styles.bannerActions}>
              <Link href="/dashboard" className={styles.bannerLink}>
                View →
              </Link>
              <button
                type="button"
                className={styles.bannerDismiss}
                onClick={() => setBanner(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </span>
          </div>
        </div>
      )}

      {children}
    </>
  );
}