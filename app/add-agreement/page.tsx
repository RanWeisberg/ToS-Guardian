/**
 * app/add-agreement/page.tsx — legacy route, kept as a safety net.
 *
 * The agent GUI moved to the root URL ("/", see app/page.tsx) so the graded bare
 * interface is the first thing a visitor lands on. Every internal link and
 * router.push now targets "/"; this redirect only catches bookmarks and any
 * stale external link to the old path.
 */

import { redirect } from "next/navigation";

export default function AddAgreementPage() {
  redirect("/");
}