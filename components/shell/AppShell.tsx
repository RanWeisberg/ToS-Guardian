"use client";

/**
 * components/shell/AppShell.tsx — the shared app chrome.
 *
 * Renders the top bar (ToS Guardian wordmark, a "Check mail" button + "Ready"
 * pill) and the four-/five-tab nav band, then the page content below it. The tabs
 * are real links; the active tab is derived from the current route (usePathname).
 *
 * The ONLY network call here is the on-demand mail check: the "Check mail" button
 * POSTs /api/mail_check (mail-checking is button-only — there is no cron). When a
 * check produces reports, a soft banner spans the app with a link to the Dashboard;
 * router.refresh() re-renders the current page so any new reports appear.
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
  { href: "/add-agreement", label: "Add agreement" },
] as const;

/** The subset of the /api/mail_check response the button reads. */
interface MailCheckResponse {
  status: "ok" | "error";
  error: string | null;
  checked: number;
  processed: number;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [checking, setChecking] = useState(false);
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
    setChecking(true);
    setError(null);
    setNoNew(false);
    try {
      const res = await fetch("/api/mail_check", { method: "POST" });
      const data = (await res.json()) as MailCheckResponse;
      if (data.status === "ok") {
        if (data.processed > 0) {
          setBanner({ count: data.processed });
        } else {
          setNoNew(true);
        }
        // Reflect any newly-produced reports on the current page (e.g. Dashboard).
        router.refresh();
      } else {
        setError("Couldn't check mail — try again");
      }
    } catch {
      setError("Couldn't check mail — try again");
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.bar}>
          <div className={styles.brand}>
            <div className={styles.logo}>
              <div className={styles.logoRing} />
            </div>
            <span className={styles.brandName}>ToS Guardian</span>
          </div>

          <div className={styles.actions}>
            {noNew && <span className={styles.microNote}>No new mail</span>}
            {error && <span className={styles.errorNote}>{error}</span>}
            <button
              type="button"
              className={styles.checkBtn}
              onClick={checkMail}
              disabled={checking}
            >
              {checking ? "Checking…" : "Check mail"}
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
