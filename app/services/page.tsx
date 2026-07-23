/**
 * app/services/page.tsx — the Services tab (tracked services + unsubscribe).
 *
 * Server component (dynamic — reads live Supabase state each request). Loads the
 * active services annotated with their standing-issue counts and hands them to the
 * client <ServicesList/>, which owns the unsubscribe flow. Dates are formatted
 * here (server-side) so the client render matches — no hydration drift.
 */

import { listServicesWithIssueCounts } from "@/lib/db";
import AppShell from "@/components/shell/AppShell";
import ServicesList from "@/components/services/ServicesList";
import type { ServiceRow } from "@/components/services/ServicesList";

export const dynamic = "force-dynamic";

/** Human-readable date, rendered once on the server. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ServicesPage() {
  const services = await listServicesWithIssueCounts();
  const rows: ServiceRow[] = services.map((s) => ({
    service: s.service,
    category: s.category,
    latestVersion: s.latestVersion,
    issueCount: s.issueCount,
    reviewed: formatDate(s.lastReviewedAt),
  }));

  return (
    <AppShell>
      <ServicesList services={rows} />
    </AppShell>
  );
}