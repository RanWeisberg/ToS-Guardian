/**
 * app/page.tsx — the root URL.
 *
 * PROJECT_SPEC.md §7 requires the GUI at root with no auth. The default landing
 * screen is the Dashboard (the triage front door), so "/" redirects there. The
 * Add-agreement screen stays at /add-agreement and remains a nav tab.
 */

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
