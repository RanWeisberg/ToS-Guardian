"use client";

/**
 * components/shell/AppShell.tsx — the shared app chrome.
 *
 * Renders the top bar (ToS Guardian wordmark + shield glyph, and a "Ready" pill)
 * and the four-tab nav band, then the page content below it. The tabs are real
 * links; the active tab is derived from the current route (usePathname), so every
 * page gets consistent, routable navigation. Chrome only — no data, no API calls.
 *
 * This is the single owner of the top-bar + tab chrome across the GUI (the two
 * screen components render their content beneath it).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/preferences", label: "Preferences" },
  { href: "/activity-log", label: "Activity Log" },
  { href: "/add-agreement", label: "Add agreement" },
] as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

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
          <div className={styles.status}>
            <span className={styles.statusDot} />
            <span className={styles.statusLabel}>Ready</span>
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

      {children}
    </>
  );
}
