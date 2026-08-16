import { formatDuration } from "@/lib/format";
import { incidentDuration, isOpen, SEVERITY_LABEL, STATUS_LABEL } from "@/lib/incidents";
import { serviceName } from "@/lib/services";
import type { CsvColumn } from "@/lib/csv";
import { auditActionLabel } from "@/server/audit";
import type { AuditEvent } from "@/server/repository/types";
import type { Incident, IncidentSeverity } from "@/types";

/**
 * Compliance and SLA reporting.
 *
 * Pure functions over records the repository already returns — no queries here,
 * so the same computation runs in a unit test with hand-built incidents as runs
 * against a live database.
 */

/**
 * Resolution targets per severity.
 *
 * These are the product's stated defaults, not a contractual SLA. They are
 * declared in one place and printed in the report so a reader can see what the
 * attainment percentage is measured against — a bare "94% attainment" with no
 * visible target is a number nobody can check.
 */
export const RESOLUTION_TARGET_MS: Record<IncidentSeverity, number> = {
  critical: 60 * 60_000,
  major: 4 * 60 * 60_000,
  warning: 24 * 60 * 60_000,
};

export interface ServiceSla {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly total: number;
  readonly open: number;
  readonly resolved: number;
  readonly critical: number;
  /** Mean time to resolution over resolved incidents, ms. `null` if none. */
  readonly mttrMs: number | null;
  /** Mean time to first responder assignment, ms. `null` if never assigned. */
  readonly mttaMs: number | null;
  /** Share of resolved incidents that met their severity's target, 0–100. */
  readonly attainmentPct: number | null;
  readonly impactedRequests: number;
}

export interface SlaReport {
  readonly generatedAt: number;
  readonly organization: { readonly id: string; readonly name: string; readonly slug: string };
  readonly window: { readonly from: number | null; readonly to: number };
  readonly totals: {
    readonly incidents: number;
    readonly open: number;
    readonly resolved: number;
    readonly mttrMs: number | null;
    readonly mttaMs: number | null;
    readonly attainmentPct: number | null;
    readonly impactedRequests: number;
  };
  readonly bySeverity: ReadonlyArray<{
    readonly severity: IncidentSeverity;
    readonly label: string;
    readonly count: number;
    readonly mttrMs: number | null;
    readonly targetMs: number;
    readonly attainmentPct: number | null;
  }>;
  readonly byService: readonly ServiceSla[];
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * Time from the incident opening to the first assignment event.
 *
 * Read off the timeline rather than stored as a column: the timeline is the
 * record of what happened, and deriving from it means the number cannot drift
 * away from the events a reader can see for themselves.
 */
function timeToAssign(incident: Incident): number | null {
  const assignment = incident.timeline.find((event) => event.kind === "assignment");
  if (!assignment) return null;
  const delta = assignment.at - incident.startedAt;
  return delta >= 0 ? delta : null;
}

function attainment(incidents: readonly Incident[]): number | null {
  const resolved = incidents.filter(
    (incident): incident is Incident & { resolvedAt: number } => incident.resolvedAt !== null,
  );
  if (resolved.length === 0) return null;

  const met = resolved.filter(
    (incident) => incident.resolvedAt - incident.startedAt <= RESOLUTION_TARGET_MS[incident.severity],
  ).length;

  return Math.round((met / resolved.length) * 1000) / 10;
}

function resolutionTimes(incidents: readonly Incident[]): number[] {
  return incidents
    .filter((incident): incident is Incident & { resolvedAt: number } => incident.resolvedAt !== null)
    .map((incident) => incident.resolvedAt - incident.startedAt);
}

export interface ReportOptions {
  readonly from?: number | null;
  readonly to?: number;
}

export function buildSlaReport(
  organization: { id: string; name: string; slug: string },
  incidents: readonly Incident[],
  options: ReportOptions = {},
): SlaReport {
  const to = options.to ?? Date.now();
  const from = options.from ?? null;

  const scoped = incidents.filter(
    (incident) => incident.startedAt <= to && (from === null || incident.startedAt >= from),
  );

  const serviceIds = [...new Set(scoped.map((incident) => incident.serviceId))].sort();

  const byService: ServiceSla[] = serviceIds.map((serviceId) => {
    const forService = scoped.filter((incident) => incident.serviceId === serviceId);
    const assignTimes = forService
      .map(timeToAssign)
      .filter((value): value is number => value !== null);

    return {
      serviceId,
      serviceName: serviceName(serviceId),
      total: forService.length,
      open: forService.filter(isOpen).length,
      resolved: forService.filter((incident) => incident.resolvedAt !== null).length,
      critical: forService.filter((incident) => incident.severity === "critical").length,
      mttrMs: mean(resolutionTimes(forService)),
      mttaMs: mean(assignTimes),
      attainmentPct: attainment(forService),
      impactedRequests: forService.reduce((sum, incident) => sum + incident.impactedRequests, 0),
    };
  });

  const severities: IncidentSeverity[] = ["critical", "major", "warning"];

  const allAssignTimes = scoped.map(timeToAssign).filter((value): value is number => value !== null);

  return {
    generatedAt: Date.now(),
    organization,
    window: { from, to },
    totals: {
      incidents: scoped.length,
      open: scoped.filter(isOpen).length,
      resolved: scoped.filter((incident) => incident.resolvedAt !== null).length,
      mttrMs: mean(resolutionTimes(scoped)),
      mttaMs: mean(allAssignTimes),
      attainmentPct: attainment(scoped),
      impactedRequests: scoped.reduce((sum, incident) => sum + incident.impactedRequests, 0),
    },
    bySeverity: severities.map((severity) => {
      const forSeverity = scoped.filter((incident) => incident.severity === severity);
      return {
        severity,
        label: SEVERITY_LABEL[severity],
        count: forSeverity.length,
        mttrMs: mean(resolutionTimes(forSeverity)),
        targetMs: RESOLUTION_TARGET_MS[severity],
        attainmentPct: attainment(forSeverity),
      };
    }),
    byService,
  };
}

/* -------------------------------------------------------------------------- */
/* CSV column definitions                                                      */
/* -------------------------------------------------------------------------- */

const iso = (value: number | null): string => (value === null ? "" : new Date(value).toISOString());

export const INCIDENT_COLUMNS: readonly CsvColumn<Incident>[] = [
  { key: "id", header: "Incident ID", value: (row) => row.id },
  { key: "title", header: "Title", value: (row) => row.title },
  { key: "service", header: "Service", value: (row) => serviceName(row.serviceId) },
  { key: "severity", header: "Severity", value: (row) => SEVERITY_LABEL[row.severity] },
  { key: "status", header: "Status", value: (row) => STATUS_LABEL[row.status] },
  { key: "assignee", header: "Responder ID", value: (row) => row.assigneeId ?? "" },
  { key: "opened_at", header: "Opened at (UTC)", value: (row) => iso(row.startedAt) },
  { key: "resolved_at", header: "Resolved at (UTC)", value: (row) => iso(row.resolvedAt) },
  {
    key: "duration_ms",
    header: "Duration (ms)",
    value: (row) => incidentDuration(row),
  },
  {
    key: "duration_human",
    header: "Duration",
    value: (row) => formatDuration(incidentDuration(row)),
  },
  {
    key: "within_target",
    header: "Met resolution target",
    value: (row) =>
      row.resolvedAt === null
        ? ""
        : row.resolvedAt - row.startedAt <= RESOLUTION_TARGET_MS[row.severity]
          ? "yes"
          : "no",
  },
  { key: "rule", header: "Opened by rule", value: (row) => row.ruleId ?? "manual" },
  { key: "impacted", header: "Impacted requests", value: (row) => row.impactedRequests },
  { key: "events", header: "Timeline entries", value: (row) => row.timeline.length },
];

export const AUDIT_COLUMNS: readonly CsvColumn<AuditEvent>[] = [
  { key: "at", header: "Timestamp (UTC)", value: (row) => iso(row.at) },
  { key: "actor", header: "Actor", value: (row) => row.actorName },
  { key: "actor_id", header: "Actor ID", value: (row) => row.actorId ?? "" },
  { key: "action", header: "Action", value: (row) => row.action },
  { key: "action_label", header: "Action (human)", value: (row) => auditActionLabel(row.action) },
  { key: "target_type", header: "Target type", value: (row) => row.targetType },
  { key: "target_id", header: "Target ID", value: (row) => row.targetId ?? "" },
  { key: "outcome", header: "Outcome", value: (row) => row.outcome },
  { key: "ip", header: "Source IP", value: (row) => row.ip ?? "" },
  { key: "metadata", header: "Metadata (JSON)", value: (row) => JSON.stringify(row.metadata) },
];

export const SLA_COLUMNS: readonly CsvColumn<ServiceSla>[] = [
  { key: "service", header: "Service", value: (row) => row.serviceName },
  { key: "service_id", header: "Service ID", value: (row) => row.serviceId },
  { key: "total", header: "Incidents", value: (row) => row.total },
  { key: "open", header: "Open", value: (row) => row.open },
  { key: "resolved", header: "Resolved", value: (row) => row.resolved },
  { key: "critical", header: "Critical", value: (row) => row.critical },
  { key: "mttr_ms", header: "MTTR (ms)", value: (row) => row.mttrMs ?? "" },
  {
    key: "mttr_human",
    header: "MTTR",
    value: (row) => (row.mttrMs === null ? "" : formatDuration(row.mttrMs)),
  },
  { key: "mtta_ms", header: "MTTA (ms)", value: (row) => row.mttaMs ?? "" },
  {
    key: "mtta_human",
    header: "MTTA",
    value: (row) => (row.mttaMs === null ? "" : formatDuration(row.mttaMs)),
  },
  { key: "attainment", header: "Target attainment (%)", value: (row) => row.attainmentPct ?? "" },
  { key: "impacted", header: "Impacted requests", value: (row) => row.impactedRequests },
];
