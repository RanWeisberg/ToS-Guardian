/**
 * app/page.tsx — the root URL.
 *
 * PROJECT_SPEC.md §7 requires the GUI at root with no auth. The default landing
 * screen is the execute/add-agreement screen (the graded bare interface), so "/"
 * redirects there.
 */

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/add-agreement");
}
