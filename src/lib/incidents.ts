import type { Incident, IncidentFilters, IncidentSeverity, IncidentStatus } from "@/types";

/**
 * Incident lifecycle.
 *
 * The transition table is deliberately explicit rather than "any status to any
 * status". An incident that jumps from Investigating straight to Resolved with
 * no Identified step produces a post-mortem timeline nobody can reconstruct, and
 * the whole point of tracking status is the timeline.
 */

export const INCIDENT_STATUSES: readonly IncidentStatus[] = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
] as const;

export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = [
  "critical",
  "major",
  "warning",
] as const;

/** Severity rank, ascending. Used for sorting and for the `minSeverity` gate. */
const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  warning: 1,
  major: 2,
  critical: 3,
};

export function severityRank(severity: IncidentSeverity): number {
  return SEVERITY_RANK[severity];
}

export function meetsMinimumSeverity(
  severity: IncidentSeverity,
  minimum: IncidentSeverity,
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minimum];
}

/**
 * Allowed next statuses.
 *
 * Backwards moves are permitted one step at a time because real incidents
 * regress — a fix that does not hold sends you from Monitoring back to
 * Identified, and forcing the operator to resolve-and-reopen would falsify the
 * duration metrics.
 */
const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  investigating: ["identified", "monitoring"],
  identified: ["monitoring", "investigating"],
  monitoring: ["resolved", "identified"],
  // Reopening is allowed: "resolved" is a claim, not a fact.
  resolved: ["investigating"],
};

export function allowedTransitions(from: IncidentStatus): readonly IncidentStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Zero-based position in the lifecycle, for the stepper UI. */
export function statusIndex(status: IncidentStatus): number {
  return INCIDENT_STATUSES.indexOf(status);
}

export function isOpen(incident: Pick<Incident, "status">): boolean {
  return incident.status !== "resolved";
}

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  critical: "Critical",
  major: "Major",
  warning: "Warning",
};

/**
 * Severity → status-palette token.
 *
 * These are the reserved status colours (good / warning / serious / critical),
 * never the categorical series colours — a severity badge must never be
 * mistakable for "series 4" on a chart.
 */
export const SEVERITY_TOKEN: Record<IncidentSeverity, "critical" | "serious" | "warning"> = {
  critical: "critical",
  major: "serious",
  warning: "warning",
};

/* -------------------------------------------------------------------------- */
/* Filtering & derived stats                                                   */
/* -------------------------------------------------------------------------- */

export const EMPTY_FILTERS: IncidentFilters = {
  severities: [],
  statuses: [],
  serviceIds: [],
  query: "",
  openOnly: false,
};

/**
 * Applies the filter row. An empty facet means "no constraint" rather than
 * "match nothing" — the alternative shows an empty table on first paint, which
 * every reader reads as "broken".
 */
export function filterIncidents(
  incidents: readonly Incident[],
  filters: IncidentFilters,
): Incident[] {
  const needle = filters.query.trim().toLowerCase();

  return incidents.filter((incident) => {
    if (filters.openOnly && incident.status === "resolved") return false;
    if (filters.severities.length > 0 && !filters.severities.includes(incident.severity)) {
      return false;
    }
    if (filters.statuses.length > 0 && !filters.statuses.includes(incident.status)) return false;
    if (filters.serviceIds.length > 0 && !filters.serviceIds.includes(incident.serviceId)) {
      return false;
    }
    if (needle.length > 0) {
      const haystack = `${incident.title} ${incident.summary} ${incident.id}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Open incidents first, then most severe, then most recent. */
export function sortIncidents(incidents: readonly Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    const openDelta = Number(isOpen(b)) - Number(isOpen(a));
    if (openDelta !== 0) return openDelta;
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) return severityDelta;
    return b.startedAt - a.startedAt;
  });
}

export interface IncidentStats {
  readonly total: number;
  readonly open: number;
  readonly critical: number;
  readonly unassigned: number;
  /** Mean time to resolution over resolved incidents, in ms. `null` if none. */
  readonly mttrMs: number | null;
}

export function summariseIncidents(incidents: readonly Incident[]): IncidentStats {
  const resolved = incidents.filter(
    (incident): incident is Incident & { resolvedAt: number } => incident.resolvedAt !== null,
  );

  const mttrMs =
    resolved.length === 0
      ? null
      : Math.round(
          resolved.reduce((sum, incident) => sum + (incident.resolvedAt - incident.startedAt), 0) /
            resolved.length,
        );

  return {
    total: incidents.length,
    open: incidents.filter(isOpen).length,
    critical: incidents.filter((incident) => isOpen(incident) && incident.severity === "critical")
      .length,
    unassigned: incidents.filter((incident) => isOpen(incident) && incident.assigneeId === null)
      .length,
    mttrMs,
  };
}

/** How long an incident has been running, or how long it ran before resolution. */
export function incidentDuration(incident: Incident, now: number = Date.now()): number {
  return (incident.resolvedAt ?? now) - incident.startedAt;
}
