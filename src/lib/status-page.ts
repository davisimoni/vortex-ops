import type {
  HealthTier,
  Incident,
  IncidentEvent,
  IncidentSeverity,
  IncidentStatus,
  ServiceDefinition,
} from "@/types";

/**
 * Pure derivation for the public status page.
 *
 * No database access and no dependency on the repository — everything here
 * takes the domain objects the caller already fetched and returns a *public*
 * shape. That split is what makes the redaction rules testable without a
 * database, and impossible to bypass by accident: a route that forgets to
 * call these functions has no other way to get status-page data.
 */

const DAY_MS = 24 * 60 * 60_000;

/** Reuses the dashboard's own status vocabulary — see `HEALTH_TIER_LABEL` in `lib/metrics.ts`. */
export const SEVERITY_TIER: Record<IncidentSeverity, HealthTier> = {
  critical: "major",
  major: "partial",
  warning: "degraded",
};

const TIER_RANK: Record<HealthTier, number> = {
  operational: 0,
  degraded: 1,
  partial: 2,
  major: 3,
};

function worstTier(tiers: readonly HealthTier[]): HealthTier {
  return tiers.reduce<HealthTier>(
    (worst, tier) => (TIER_RANK[tier] > TIER_RANK[worst] ? tier : worst),
    "operational",
  );
}

/* -------------------------------------------------------------------------- */
/* Current status                                                             */
/* -------------------------------------------------------------------------- */

export interface ServiceStatus {
  readonly serviceId: string;
  readonly name: string;
  readonly tier: HealthTier;
}

/** One row per monitored service, derived from which incidents are open right now. */
export function currentServiceStatus(
  services: readonly ServiceDefinition[],
  incidents: readonly Incident[],
  now: number = Date.now(),
): ServiceStatus[] {
  return services.map((service) => {
    const open = incidents.filter(
      (incident) =>
        incident.serviceId === service.id && incident.status !== "resolved" && incident.startedAt <= now,
    );
    return {
      serviceId: service.id,
      name: service.name,
      tier: worstTier(open.map((incident) => SEVERITY_TIER[incident.severity])),
    };
  });
}

/** The single headline status — the worst tier across every monitored service. */
export function aggregateStatus(serviceStatuses: readonly ServiceStatus[]): HealthTier {
  return worstTier(serviceStatuses.map((entry) => entry.tier));
}

/* -------------------------------------------------------------------------- */
/* Uptime history                                                             */
/* -------------------------------------------------------------------------- */

export interface DayUptime {
  /** UTC calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly tier: HealthTier;
}

/**
 * One cell per calendar day, oldest first, for the trailing `days` days.
 *
 * A day's tier is the worst severity of any incident whose window overlaps
 * that day at all — a 5-minute critical blip and a 20-hour one both mark the
 * day, the same trade-off every public status page with daily granularity
 * makes. Boundaries are UTC calendar days, not "24 hours before now": a fixed
 * grid is what lets the same day cell mean the same thing however many times
 * the page reloads today.
 */
export function buildUptimeHistory(
  incidents: readonly Incident[],
  days = 90,
  now: number = Date.now(),
): DayUptime[] {
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;

  const history: DayUptime[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dayStart = todayStart - offset * DAY_MS;
    const dayEnd = dayStart + DAY_MS;

    const overlapping = incidents.filter((incident) => {
      const incidentEnd = incident.resolvedAt ?? now;
      return incident.startedAt < dayEnd && incidentEnd >= dayStart;
    });

    history.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      tier: worstTier(overlapping.map((incident) => SEVERITY_TIER[incident.severity])),
    });
  }

  return history;
}

/** Per-day penalty for the headline uptime percentage — not a real-time SLA measurement. */
const TIER_PENALTY: Record<HealthTier, number> = {
  operational: 0,
  degraded: 0.25,
  partial: 0.6,
  major: 1,
};

/**
 * Headline uptime percentage implied by the daily history.
 *
 * This is a coarse, day-granular estimate for the public page's headline
 * number — not a claim of measured per-minute availability, which this
 * product does not collect. `major` days count as a full day down; `degraded`
 * days cost a quarter, since "degraded" by definition is not full downtime.
 */
export function uptimePercent(history: readonly DayUptime[]): number {
  if (history.length === 0) return 100;
  const impacted = history.reduce((sum, day) => sum + TIER_PENALTY[day.tier], 0);
  return Math.round((1 - impacted / history.length) * 10_000) / 100;
}

/* -------------------------------------------------------------------------- */
/* Incident redaction                                                         */
/* -------------------------------------------------------------------------- */

export interface PublicIncidentUpdate {
  readonly at: number;
  readonly message: string;
}

export interface PublicIncident {
  readonly id: string;
  readonly title: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly serviceId: string;
  readonly startedAt: number;
  readonly resolvedAt: number | null;
  readonly updates: readonly PublicIncidentUpdate[];
}

/**
 * Timeline entries a stranger on the internet may see.
 *
 * `assignment` names an employee and is nobody's business outside the
 * organisation; `notification` describes internal paging plumbing
 * ("Notified #incidents on Slack…"). Both are dropped entirely, not just
 * stripped of their actor — the message text itself is internal.
 */
const PUBLIC_EVENT_KINDS: ReadonlySet<IncidentEvent["kind"]> = new Set(["opened", "status", "note"]);

/**
 * Strips one incident down to what a customer-facing status page may show.
 *
 * `actor` is never copied onto a `PublicIncidentUpdate` — not even redacted to
 * a placeholder — because the field does not exist on the public shape at
 * all. A future caller cannot forget to blank it if there is nowhere to put it.
 */
export function redactIncidentForStatusPage(incident: Incident): PublicIncident {
  return {
    id: incident.id,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    serviceId: incident.serviceId,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    updates: incident.timeline
      .filter((event) => PUBLIC_EVENT_KINDS.has(event.kind))
      .map((event) => ({ at: event.at, message: event.message })),
  };
}

/** Incidents that started within `windowDays`, newest first, redacted for public display. */
export function recentIncidentsForStatusPage(
  incidents: readonly Incident[],
  windowDays = 90,
  now: number = Date.now(),
): PublicIncident[] {
  const cutoff = now - windowDays * DAY_MS;
  return incidents
    .filter((incident) => incident.startedAt >= cutoff)
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(redactIncidentForStatusPage);
}
