"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

import { TopologyGraph } from "@/components/topology/topology-graph";
import { SeverityBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLatency, formatPercent, formatRelative } from "@/lib/format";
import { HEALTH_TIER_LABEL } from "@/lib/metrics";
import { deriveTopologyStatus } from "@/lib/topology";
import { SERVICES, TIER_LABEL } from "@/lib/services";
import { useIncidentStore } from "@/store/incident-store";
import { useMetricsStore } from "@/store/metrics-store";

/**
 * `/dashboard/topology` — the service map.
 *
 * Reads from the same global stores every other page does (`LiveEngine`,
 * mounted once in the app shell, already keeps `metrics-store` streaming and
 * `incident-store` loaded regardless of which page is open) rather than
 * fetching its own copy — a second, independent fetch of data the app
 * already has loaded would just be a second thing that can disagree with the
 * first.
 */
export function TopologyView() {
  const incidentsReady = useIncidentStore((state) => state.ready);
  const incidents = useIncidentStore((state) => state.incidents);
  const metricsReady = useMetricsStore((state) => state.ready);
  const latestSample = useMetricsStore((state) => state.series[state.series.length - 1] ?? null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!incidentsReady || !metricsReady) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const statuses = deriveTopologyStatus(SERVICES, incidents, latestSample);
  const selected = statuses.find((status) => status.serviceId === selectedId) ?? null;
  const selectedIncidents = selected
    ? incidents
        .filter((incident) => incident.serviceId === selected.serviceId && incident.status !== "resolved")
        .sort((a, b) => b.startedAt - a.startedAt)
    : [];

  const degraded = statuses.filter((status) => status.health !== "operational").length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Service topology"
          subtitle={
            degraded === 0
              ? "Every monitored service is operational. Gateway → Auth/Payments/Search → Database."
              : `${degraded} of ${statuses.length} services degraded or worse. Click a node for detail.`
          }
        />
        <CardBody>
          <TopologyGraph statuses={statuses} selectedId={selectedId} onSelect={setSelectedId} />
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            Health is derived from open incidents on each service. Latency and error-rate figures are
            estimated from live telemetry, scaled per service — see{" "}
            <Link href="/dashboard" className="underline underline-offset-2 hover:text-ink2">
              the dashboard
            </Link>{" "}
            for the org-wide signal they are derived from.
          </p>
        </CardBody>
      </Card>

      <Drawer
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? ""}
        subtitle={
          selected ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{TIER_LABEL[selected.tier]}</span>
              <span aria-hidden="true">·</span>
              <span>{selected.owner}</span>
              <span aria-hidden="true">·</span>
              <span>{HEALTH_TIER_LABEL[selected.health]}</span>
            </span>
          ) : undefined
        }
      >
        {selected ? (
          <div className="flex flex-col gap-5">
            <section className="grid grid-cols-2 gap-4 rounded-lg border border-hairline bg-raised/40 p-3">
              <div>
                <p className="text-[11px] text-muted">Latency (p95, estimated)</p>
                <p className="tabular mt-0.5 text-sm font-medium text-ink">
                  {formatLatency(selected.latencyMsEstimate)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted">Error rate (estimated)</p>
                <p className="tabular mt-0.5 text-sm font-medium text-ink">
                  {formatPercent(selected.errorRatePctEstimate)}
                </p>
              </div>
            </section>

            <section>
              <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                Open incidents
                <Link
                  href="/incidents"
                  className="flex items-center gap-1 text-[11px] font-normal normal-case text-brand hover:underline"
                >
                  View all
                  <ArrowRight aria-hidden="true" className="size-3" />
                </Link>
              </h3>

              {selectedIncidents.length === 0 ? (
                <p className="rounded-lg border border-hairline bg-raised/40 p-3 text-xs text-muted">
                  No open incidents on this service.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-hairline">
                  {selectedIncidents.map((incident) => (
                    <li key={incident.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-crit" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink">{incident.title}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                          <SeverityBadge severity={incident.severity} />
                          <span className="tabular">{incident.id}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatRelative(incident.startedAt)}</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
