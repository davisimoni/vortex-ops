"use client";

import { Inbox, Plus, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { AlertRulesCard } from "@/components/incidents/alert-rules-card";
import { DeclareIncidentForm } from "@/components/incidents/declare-incident-form";
import { IncidentDrawer } from "@/components/incidents/incident-drawer";
import { IncidentFilters } from "@/components/incidents/incident-filters";
import { IncidentTable } from "@/components/incidents/incident-table";
import { ComplianceExportCard } from "@/components/compliance/compliance-export-card";
import { usePermission } from "@/components/system/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";
import { filterIncidents, sortIncidents, summariseIncidents } from "@/lib/incidents";
import { useIncidentStore } from "@/store/incident-store";
import { useTeamStore } from "@/store/team-store";

/**
 * Relative timestamps re-rendered on a slow tick.
 *
 * One clock shared by every row: computing `Date.now()` per row would let two
 * incidents opened in the same second render as "1m ago" and "2m ago".
 */
function useSharedClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function StatStrip({
  items,
}: {
  readonly items: ReadonlyArray<{ label: string; value: string }>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-hairline bg-surface p-3">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-1 text-xl font-semibold text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function IncidentsView() {
  const ready = useIncidentStore((state) => state.ready);
  const loadError = useIncidentStore((state) => state.loadError);
  const incidents = useIncidentStore((state) => state.incidents);
  const filters = useIncidentStore((state) => state.filters);
  const selectedId = useIncidentStore((state) => state.selectedId);
  const select = useIncidentStore((state) => state.select);
  const resetFilters = useIncidentStore((state) => state.resetFilters);
  const load = useIncidentStore((state) => state.load);
  const members = useTeamStore((state) => state.members);
  const mayExport = usePermission("compliance:export");
  const mayDeclare = usePermission("incident:create");

  const [declaring, setDeclaring] = useState(false);
  const now = useSharedClock();

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardBody className="text-sm text-crit">{loadError}</CardBody>
      </Card>
    );
  }

  const stats = summariseIncidents(incidents);
  const visible = sortIncidents(filterIncidents(incidents, filters));
  const selected = incidents.find((incident) => incident.id === selectedId) ?? null;
  const filtersActive = visible.length !== incidents.length;

  return (
    <div className="flex flex-col gap-4">
      <StatStrip
        items={[
          { label: "Open", value: String(stats.open) },
          { label: "Critical", value: String(stats.critical) },
          { label: "Unassigned", value: String(stats.unassigned) },
          { label: "MTTR", value: stats.mttrMs === null ? "—" : formatDuration(stats.mttrMs) },
        ]}
      />

      <IncidentFilters />

      {declaring ? <DeclareIncidentForm onDone={() => setDeclaring(false)} /> : null}

      <Card>
        <CardHeader
          title="Incidents"
          subtitle={
            filtersActive
              ? `${visible.length} of ${incidents.length} incidents match the current filters.`
              : `${incidents.length} incidents. Open first, then by severity.`
          }
          actions={
            !declaring && mayDeclare ? (
              <Button size="sm" variant="primary" onClick={() => setDeclaring(true)}>
                <Plus aria-hidden="true" className="size-3.5" />
                Declare incident
              </Button>
            ) : null
          }
        />
        <CardBody>
          {visible.length === 0 ? (
            incidents.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No incidents recorded"
                body="Nothing has breached a rule and nobody has declared an incident manually. The alerting engine is running against every incoming sample."
                action={
                  mayDeclare && !declaring ? (
                    <Button size="sm" variant="primary" onClick={() => setDeclaring(true)}>
                      <Plus aria-hidden="true" className="size-3.5" />
                      Declare incident
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                icon={SearchX}
                title="No incidents match these filters"
                body="Every incident was excluded by the current severity, status, service or search filters."
                action={
                  <Button size="sm" variant="secondary" onClick={resetFilters}>
                    Clear filters
                  </Button>
                }
              />
            )
          ) : (
            <IncidentTable
              incidents={visible}
              members={members}
              selectedId={selectedId}
              onSelect={select}
              now={now}
            />
          )}
        </CardBody>
      </Card>

      <AlertRulesCard />

      {mayExport ? <ComplianceExportCard /> : null}

      <IncidentDrawer incident={selected} onClose={() => select(null)} now={now} />
    </div>
  );
}
