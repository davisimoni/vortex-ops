import { CalendarClock, CheckCircle2 } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { formatTimestamp } from "@/lib/format";
import { MAINTENANCE_STATUS_LABEL, type PublicMaintenanceWindow } from "@/lib/maintenance";
import { HEALTH_TIER_LABEL } from "@/lib/metrics";
import { SEVERITY_TIER, type DayUptime, type PublicIncident, type ServiceStatus } from "@/lib/status-page";
import { cn } from "@/lib/utils";
import type { HealthTier, MaintenanceStatus } from "@/types";

const MAINTENANCE_TONE: Record<MaintenanceStatus, BadgeTone> = {
  scheduled: "brand",
  in_progress: "warning",
  completed: "neutral",
  cancelled: "neutral",
};

const TIER_TONE: Record<HealthTier, BadgeTone> = {
  operational: "good",
  degraded: "warning",
  partial: "serious",
  major: "critical",
};

const TIER_BAR: Record<HealthTier, string> = {
  operational: "bg-good",
  degraded: "bg-warn",
  partial: "bg-serious",
  major: "bg-crit",
};

const TIER_BANNER: Record<HealthTier, string> = {
  operational: "border-good/35 bg-good/10",
  degraded: "border-warn/40 bg-warn/10",
  partial: "border-serious/40 bg-serious/10",
  major: "border-crit/40 bg-crit/10",
};

export interface StatusPageViewProps {
  readonly organizationName: string;
  readonly aggregateTier: HealthTier;
  readonly serviceStatuses: readonly ServiceStatus[];
  readonly uptimeHistory: readonly DayUptime[];
  readonly uptimePercentValue: number;
  readonly incidents: readonly PublicIncident[];
  readonly maintenanceWindows: readonly PublicMaintenanceWindow[];
}

export function StatusPageView({
  organizationName,
  aggregateTier,
  serviceStatuses,
  uptimeHistory,
  uptimePercentValue,
  incidents,
  maintenanceWindows,
}: StatusPageViewProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Status</p>
          <h1 className="text-lg font-semibold tracking-tight text-ink">{organizationName}</h1>
        </div>
        <ThemeToggle />
      </header>

      <Card className={TIER_BANNER[aggregateTier]}>
        <CardBody className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn("size-2.5 shrink-0 rounded-full", TIER_BAR[aggregateTier])}
          />
          <p className="text-sm font-semibold text-ink">{HEALTH_TIER_LABEL[aggregateTier]}</p>
        </CardBody>
      </Card>

      <section aria-labelledby="services-heading" className="flex flex-col gap-2">
        <h2 id="services-heading" className="text-sm font-semibold text-ink">
          Services
        </h2>
        <Card>
          <ul className="divide-y divide-hairline">
            {serviceStatuses.map((service) => (
              <li key={service.serviceId} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm text-ink2">{service.name}</span>
                <Badge tone={TIER_TONE[service.tier]} dot>
                  {HEALTH_TIER_LABEL[service.tier]}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="uptime-heading" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="uptime-heading" className="text-sm font-semibold text-ink">
            Uptime — last {uptimeHistory.length} days
          </h2>
          <span className="tabular text-sm font-medium text-ink2">{uptimePercentValue}%</span>
        </div>
        <Card>
          <CardBody>
            <div className="flex items-end gap-[3px] overflow-x-auto pb-1" role="img" aria-label={`Daily status for the last ${uptimeHistory.length} days, ${uptimePercentValue}% uptime`}>
              {uptimeHistory.map((day) => (
                <span
                  key={day.date}
                  title={`${day.date} — ${HEALTH_TIER_LABEL[day.tier]}`}
                  className={cn("h-8 w-1.5 shrink-0 rounded-sm sm:w-2", TIER_BAR[day.tier])}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted">
              <span>{uptimeHistory[0]?.date}</span>
              <span>{uptimeHistory[uptimeHistory.length - 1]?.date}</span>
            </div>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="maintenance-heading" className="flex flex-col gap-2">
        <h2 id="maintenance-heading" className="text-sm font-semibold text-ink">
          Scheduled maintenance
        </h2>
        {maintenanceWindows.length === 0 ? (
          <Card>
            <CardBody className="flex items-center gap-2.5 text-sm text-ink2">
              <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-muted" />
              No scheduled maintenance.
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {maintenanceWindows.map((window) => (
              <Card key={window.id}>
                <CardBody className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-ink">{window.title}</h3>
                    <Badge tone={MAINTENANCE_TONE[window.status]}>
                      {MAINTENANCE_STATUS_LABEL[window.status]}
                    </Badge>
                  </div>
                  {window.description ? (
                    <p className="text-xs leading-relaxed text-ink2">{window.description}</p>
                  ) : null}
                  <p className="tabular text-xs text-muted">
                    {formatTimestamp(window.startsAt)} → {formatTimestamp(window.endsAt)}
                    <span aria-hidden="true"> · </span>
                    {window.serviceNames.join(", ")}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="incidents-heading" className="flex flex-col gap-2">
        <h2 id="incidents-heading" className="text-sm font-semibold text-ink">
          Incident history
        </h2>

        {incidents.length === 0 ? (
          <Card>
            <CardBody className="flex items-center gap-2.5 text-sm text-ink2">
              <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-good" />
              No incidents in the last 90 days.
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {incidents.map((incident) => (
              <Card key={incident.id}>
                <CardBody className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-ink">{incident.title}</h3>
                    <Badge tone={TIER_TONE[SEVERITY_TIER[incident.severity]]}>
                      {incident.status === "resolved" ? "Resolved" : "Ongoing"}
                    </Badge>
                  </div>
                  <ol className="flex flex-col gap-1.5 border-l border-hairline pl-3">
                    {incident.updates.map((update, index) => (
                      <li key={index} className="text-xs text-ink2">
                        <span className="tabular text-muted">{formatTimestamp(update.at)}</span>{" "}
                        {update.message}
                      </li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-2 text-center text-[11px] text-muted">
        Powered by Vortex Ops
      </footer>
    </main>
  );
}
