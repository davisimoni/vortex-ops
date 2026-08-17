/**
 * Domain types for Vortex Ops.
 *
 * Everything the UI, the stores and the API routes agree on lives here so a
 * shape change surfaces as a type error in every consumer at once.
 */

/* -------------------------------------------------------------------------- */
/* Services                                                                    */
/* -------------------------------------------------------------------------- */

export type ServiceTier = "edge" | "core" | "data" | "async";

export interface ServiceDefinition {
  readonly id: string;
  readonly name: string;
  readonly tier: ServiceTier;
  /** Owning team — shown on the incident card so the reader knows who to page. */
  readonly owner: string;
  /** Baseline behaviour of the simulator for this service. */
  readonly baseline: {
    readonly latencyMs: number;
    readonly cpuPct: number;
    readonly errorRatePct: number;
    readonly throughputRps: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

export type TimeRangeId = "1h" | "24h" | "7d" | "30d";

export interface TimeRangeSpec {
  readonly id: TimeRangeId;
  readonly label: string;
  /** Accessible expansion of the abbreviated label. */
  readonly description: string;
  readonly durationMs: number;
  readonly points: number;
  readonly stepMs: number;
  /** How x-axis ticks are rendered for this range. */
  readonly tickFormat: "clock" | "day";
}

/**
 * One sample of the whole system at time `t`.
 *
 * Latency is carried as three percentiles rather than a mean: a mean latency
 * hides exactly the tail that wakes people up at 3am.
 */
export interface MetricPoint {
  /** Epoch milliseconds. */
  readonly t: number;
  readonly latencyP50: number;
  readonly latencyP95: number;
  readonly latencyP99: number;
  /** CPU load across the fleet, percent. */
  readonly cpu: number;
  /** Share of responses that were 5xx, percent. */
  readonly errorRate: number;
  /** Requests per second. */
  readonly throughput: number;
}

export type MetricKey = Exclude<keyof MetricPoint, "t">;

export type HealthTier = "operational" | "degraded" | "partial" | "major";

export interface HealthAssessment {
  /** 0–100, higher is healthier. */
  readonly score: number;
  readonly tier: HealthTier;
  /** Which metric contributed the largest penalty — the thing to look at first. */
  readonly driver: MetricKey | "incidents" | null;
}

export type StreamStatus = "connecting" | "live" | "reconnecting" | "offline" | "paused";

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

/** Ordered least → most severe, so comparisons can use the index. */
export type IncidentSeverity = "warning" | "major" | "critical";

/** The lifecycle an on-call engineer walks an incident through. */
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

export interface IncidentEvent {
  readonly id: string;
  readonly at: number;
  readonly kind: "opened" | "status" | "assignment" | "note" | "notification";
  readonly message: string;
  /** Display name of whoever caused the event; `null` for the alerting engine. */
  readonly actor: string | null;
}

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly serviceId: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  /** Member id, or `null` when nobody has picked it up yet. */
  readonly assigneeId: string | null;
  readonly startedAt: number;
  readonly resolvedAt: number | null;
  /** Which alert rule opened it, when it was opened automatically. */
  readonly ruleId: string | null;
  readonly impactedRequests: number;
  readonly timeline: readonly IncidentEvent[];
}

export interface IncidentFilters {
  readonly severities: readonly IncidentSeverity[];
  readonly statuses: readonly IncidentStatus[];
  readonly serviceIds: readonly string[];
  readonly query: string;
  /** `true` hides resolved incidents regardless of the status filter. */
  readonly openOnly: boolean;
}

/* -------------------------------------------------------------------------- */
/* Alerting                                                                    */
/* -------------------------------------------------------------------------- */

export type Comparator = "gt" | "lt";

export interface AlertRule {
  readonly id: string;
  readonly name: string;
  readonly metric: MetricKey;
  readonly comparator: Comparator;
  readonly threshold: number;
  /** Consecutive breaching samples required before the rule fires. */
  readonly forSamples: number;
  readonly severity: IncidentSeverity;
  readonly serviceId: string;
  readonly enabled: boolean;
}

export interface AlertEvaluation {
  readonly rule: AlertRule;
  readonly breached: boolean;
  /** Value of the most recent sample, for the incident summary. */
  readonly observed: number;
  readonly consecutive: number;
}

/* -------------------------------------------------------------------------- */
/* Team & RBAC                                                                 */
/* -------------------------------------------------------------------------- */

export type Role = "owner" | "devops" | "viewer";

export type MemberStatus = "active" | "invited" | "suspended";

export interface TeamMember {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly status: MemberStatus;
  readonly lastActiveAt: number | null;
  /** On-call rotation the member belongs to, or `null`. */
  readonly rotation: string | null;
}

/* -------------------------------------------------------------------------- */
/* Integrations                                                                */
/* -------------------------------------------------------------------------- */

export type IntegrationProvider =
  | "slack"
  | "pagerduty"
  | "discord"
  | "telegram"
  | "email"
  | "webhook";

export type WebhookEvent =
  | "incident.opened"
  | "incident.status_changed"
  | "incident.assigned"
  | "incident.resolved"
  | "alert.triggered";

export interface Integration {
  readonly id: string;
  readonly provider: IntegrationProvider;
  readonly name: string;
  readonly targetUrl: string;
  readonly enabled: boolean;
  readonly events: readonly WebhookEvent[];
  /** Only fire for incidents at this severity or above. */
  readonly minSeverity: IncidentSeverity;
  readonly createdAt: number;
  readonly lastDelivery: DeliveryResult | null;
  /**
   * Masked tail of the stored credential (`••••4f2a`), or `null` when the
   * integration has none. This is the *only* form of a credential that reaches
   * the browser — enough to confirm which token is configured, useless to
   * anyone who intercepts it.
   */
  readonly credentialHint: string | null;
}

export interface DeliveryResult {
  readonly ok: boolean;
  readonly at: number;
  readonly status: number | null;
  readonly durationMs: number;
  /** Short, human-readable outcome. Never carries the response body verbatim. */
  readonly detail: string;
}

/* -------------------------------------------------------------------------- */
/* Maintenance windows                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `scheduled`/`in_progress`/`completed` are always derived from `startsAt`/
 * `endsAt` against the clock — see `deriveMaintenanceStatus()` in
 * `lib/maintenance.ts` — never stored. `cancelled` is the one state that is a
 * real event rather than a function of time.
 */
export type MaintenanceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export interface MaintenanceWindow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly serviceIds: readonly string[];
  readonly startsAt: number;
  readonly endsAt: number;
  readonly cancelledAt: number | null;
  readonly createdAt: number;
}
