/**
 * app/activity-log/page.tsx — the Activity Log tab (PROJECT_SPEC §7 Tab 3).
 *
 * Server component (dynamic — reads live Supabase state each request). Loads the
 * full review history (listActivity — every agreement_versions row, including
 * since-unsubscribed services) and hands it to the client <ActivityLog/>. Dates
 * are formatted here (server-side) so the client render matches — no hydration
 * drift. Read-only, no LLM.
 */

import { listActivity } from "@/lib/db";
import AppShell from "@/components/shell/AppShell";
import ActivityLog from "@/components/activity-log/ActivityLog";
import type { ActivityItem } from "@/components/activity-log/ActivityLog";

export const dynamic = "force-dynamic";

/** Human-readable date + time, rendered once on the server. */
function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ActivityLogPage() {
  const activity = await listActivity();
  const items: ActivityItem[] = activity.map((a) => ({
    service: a.service,
    category: a.category,
    version: a.version,
    reportId: a.reportId,
    status: a.status,
    when: formatTimestamp(a.at),
  }));

  return (
    <AppShell>
      <ActivityLog items={items} />
    </AppShell>
  );
}