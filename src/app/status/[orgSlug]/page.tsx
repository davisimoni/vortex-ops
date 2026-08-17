import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StatusPageView } from "@/components/status/status-page-view";
import { maintenanceWindowsForStatusPage } from "@/lib/maintenance";
import { SERVICES } from "@/lib/services";
import {
  aggregateStatus,
  buildUptimeHistory,
  currentServiceStatus,
  recentIncidentsForStatusPage,
  uptimePercent,
} from "@/lib/status-page";
import { getRepository } from "@/server/repository";

/**
 * Public, unauthenticated status page — no session, no organisation switcher,
 * no membership check. The slug is the entire access control: anyone who
 * knows (or guesses) `/status/acme-corp` can read it, which is the intended
 * behaviour for a status page, not an oversight. Nothing rendered here comes
 * from `Incident` directly — everything passes through the redaction
 * functions in `lib/status-page.ts` first.
 */
export const dynamic = "force-dynamic";

interface StatusPageParams {
  readonly orgSlug: string;
}

async function loadOrganization(orgSlug: string) {
  const repository = await getRepository();
  return repository.getOrganizationBySlug(orgSlug);
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<StatusPageParams>;
}): Promise<Metadata> {
  const { orgSlug } = await params;
  const organization = await loadOrganization(orgSlug);

  if (!organization) return { title: "Status" };

  return {
    title: `${organization.name} Status`,
    description: `Live service status, uptime history and incident updates for ${organization.name}.`,
    // The root layout opts the whole app out of indexing — this is the one
    // route meant for the public, so it opts back in explicitly rather than
    // inheriting a default that would otherwise hide it from search.
    robots: { index: true, follow: true },
  };
}

export default async function StatusPage({
  params,
}: {
  readonly params: Promise<StatusPageParams>;
}) {
  const { orgSlug } = await params;
  const organization = await loadOrganization(orgSlug);

  // A cross-tenant or made-up slug is a 404, the same as a cross-tenant id
  // anywhere else in this app — it neither confirms nor denies which slugs
  // are real beyond "this one isn't".
  if (!organization) notFound();

  const repository = await getRepository();
  const [incidents, maintenanceWindows] = await Promise.all([
    repository.listIncidents(organization.id),
    repository.listMaintenanceWindows(organization.id),
  ]);

  const serviceStatuses = currentServiceStatus(SERVICES, incidents);
  const uptimeHistory = buildUptimeHistory(incidents);

  return (
    <StatusPageView
      organizationName={organization.name}
      aggregateTier={aggregateStatus(serviceStatuses)}
      serviceStatuses={serviceStatuses}
      uptimeHistory={uptimeHistory}
      uptimePercentValue={uptimePercent(uptimeHistory)}
      incidents={recentIncidentsForStatusPage(incidents)}
      maintenanceWindows={maintenanceWindowsForStatusPage(maintenanceWindows)}
    />
  );
}
