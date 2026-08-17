import { hashPassword } from "@/server/crypto/password";
import type {
  CredentialBundle,
  IntegrationDraftInput,
  MembershipRecord,
  Organization,
  StoredUser,
} from "@/server/repository/types";
import type { Incident, IncidentEvent, MaintenanceWindow, MemberStatus, Role } from "@/types";

/**
 * Demo fixtures, shared by both storage drivers.
 *
 * Two tenants on purpose. A single-organisation fixture cannot demonstrate
 * isolation — the interesting assertion is that Acme's incidents are *absent*
 * from Stark, and you need a second tenant with different data to make that
 * assertion mean anything.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Demo credentials.
 *
 * Read from the environment when supplied so a deployed demo is not signed in
 * with a password printed in a public README. The literal is the local default,
 * and it is never a fallback in production: `assertDemoPasswordIsSafe` refuses
 * to boot a production build that never set one.
 */
export const DEMO_PASSWORD = process.env.VORTEX_DEMO_PASSWORD ?? "vortex-demo-2026";

export function assertDemoPasswordIsSafe(): void {
  if (process.env.VORTEX_ENV === "production" && !process.env.VORTEX_DEMO_PASSWORD) {
    throw new Error(
      "Refusing to seed demo accounts in production without VORTEX_DEMO_PASSWORD. " +
        "Set it, or disable seeding with VORTEX_SKIP_SEED=1.",
    );
  }
}

export const ORGANIZATIONS: readonly Organization[] = [
  {
    id: "org_acme",
    slug: "acme-corp",
    name: "Acme Corp",
    environment: "production",
    metricSeed: 1_337,
  },
  {
    id: "org_stark",
    slug: "stark-industries",
    name: "Stark Industries",
    environment: "staging",
    metricSeed: 8_021,
  },
] as const;

interface SeedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly memberships: ReadonlyArray<{
    readonly orgId: string;
    readonly role: Role;
    readonly status: MemberStatus;
    readonly rotation: string | null;
    readonly lastSeenAgoMs: number | null;
  }>;
}

const USERS: readonly SeedUser[] = [
  {
    id: "usr_ada",
    email: "ada.okafor@vortex-ops.example",
    name: "Ada Okafor",
    memberships: [
      {
        orgId: "org_acme",
        role: "owner",
        status: "active",
        rotation: "Platform primary",
        lastSeenAgoMs: 4 * MINUTE,
      },
      // Deliberately a different role in the second tenant: roles are per
      // organisation, and the switcher has to prove it.
      {
        orgId: "org_stark",
        role: "viewer",
        status: "active",
        rotation: null,
        lastSeenAgoMs: 2 * DAY,
      },
    ],
  },
  {
    id: "usr_marco",
    email: "marco.bellini@vortex-ops.example",
    name: "Marco Bellini",
    memberships: [
      {
        orgId: "org_acme",
        role: "devops",
        status: "active",
        rotation: "Platform primary",
        lastSeenAgoMs: 18 * MINUTE,
      },
    ],
  },
  {
    id: "usr_priya",
    email: "priya.raman@vortex-ops.example",
    name: "Priya Raman",
    memberships: [
      {
        orgId: "org_acme",
        role: "devops",
        status: "active",
        rotation: "Data secondary",
        lastSeenAgoMs: 2 * HOUR,
      },
    ],
  },
  {
    id: "usr_tomas",
    email: "tomas.herrera@vortex-ops.example",
    name: "Tomás Herrera",
    memberships: [
      {
        orgId: "org_acme",
        role: "devops",
        status: "active",
        rotation: "Identity primary",
        lastSeenAgoMs: 6 * HOUR,
      },
    ],
  },
  {
    id: "usr_lena",
    email: "lena.vogt@vortex-ops.example",
    name: "Lena Vogt",
    memberships: [
      { orgId: "org_acme", role: "viewer", status: "active", rotation: null, lastSeenAgoMs: 3 * DAY },
    ],
  },
  {
    id: "usr_sam",
    email: "sam.whitfield@vortex-ops.example",
    name: "Sam Whitfield",
    memberships: [
      { orgId: "org_acme", role: "viewer", status: "invited", rotation: null, lastSeenAgoMs: null },
    ],
  },
  {
    id: "usr_nina",
    email: "nina.kovac@vortex-ops.example",
    name: "Nina Kovač",
    memberships: [
      {
        orgId: "org_stark",
        role: "owner",
        status: "active",
        rotation: "Arc reactor on-call",
        lastSeenAgoMs: 12 * MINUTE,
      },
    ],
  },
] as const;

export interface SeedMembership extends MembershipRecord {
  readonly rotation: string | null;
  readonly lastSeenAt: number | null;
}

export interface SeedIntegration extends IntegrationDraftInput {
  readonly id: string;
  readonly orgId: string;
  readonly credential: CredentialBundle | null;
}

export interface SeedBundle {
  readonly organizations: readonly Organization[];
  readonly users: readonly StoredUser[];
  readonly memberships: readonly SeedMembership[];
  readonly incidents: readonly (Incident & { readonly orgId: string })[];
  readonly integrations: readonly SeedIntegration[];
  readonly maintenanceWindows: readonly (MaintenanceWindow & { readonly orgId: string })[];
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

interface SeedEvent {
  readonly atAgoMs: number;
  readonly kind: IncidentEvent["kind"];
  readonly message: string;
  readonly actor: string | null;
}

interface SeedIncidentShape {
  readonly orgId: string;
  readonly key: string;
  readonly title: string;
  readonly summary: string;
  readonly serviceId: string;
  readonly severity: Incident["severity"];
  readonly status: Incident["status"];
  readonly assigneeId: string | null;
  readonly startedAgoMs: number;
  readonly resolvedAgoMs: number | null;
  readonly ruleId: string | null;
  readonly impactedRequests: number;
  readonly timeline: readonly SeedEvent[];
}

const INCIDENTS: readonly SeedIncidentShape[] = [
  {
    orgId: "org_acme",
    key: "INC-2411",
    title: "API Gateway — 5xx error rate above 2%",
    summary:
      "Error rate on the public gateway climbed to 3.8% after the 14:02 deploy of gateway@2.19.0. " +
      "Failures concentrate on POST /v2/checkout with upstream connection resets.",
    serviceId: "api-gateway",
    severity: "critical",
    status: "identified",
    assigneeId: "usr_marco",
    startedAgoMs: 52 * MINUTE,
    resolvedAgoMs: null,
    ruleId: "rule_5xx_critical",
    impactedRequests: 184_920,
    timeline: [
      {
        atAgoMs: 52 * MINUTE,
        kind: "opened",
        message: "Rule “5xx error rate above 2%” breached for 3 consecutive samples.",
        actor: null,
      },
      {
        atAgoMs: 51 * MINUTE,
        kind: "notification",
        message: "Notified #incidents on Slack and the Platform primary rotation on PagerDuty.",
        actor: null,
      },
      { atAgoMs: 47 * MINUTE, kind: "assignment", message: "Assigned to Marco Bellini.", actor: "Ada Okafor" },
      {
        atAgoMs: 31 * MINUTE,
        kind: "note",
        message:
          "Connection pool exhaustion on the checkout upstream. Pool size was halved in the 2.19.0 config change.",
        actor: "Marco Bellini",
      },
      {
        atAgoMs: 29 * MINUTE,
        kind: "status",
        message: "Status changed from Investigating to Identified.",
        actor: "Marco Bellini",
      },
    ],
  },
  {
    orgId: "org_acme",
    key: "INC-2409",
    title: "Search Index — replica lag above 90 s",
    summary:
      "The read replica behind /search fell 2 minutes behind the primary during the nightly reindex, " +
      "so a share of queries returned stale results.",
    serviceId: "search-index",
    severity: "major",
    status: "monitoring",
    assigneeId: "usr_priya",
    startedAgoMs: 5 * HOUR,
    resolvedAgoMs: null,
    ruleId: null,
    impactedRequests: 42_300,
    timeline: [
      { atAgoMs: 5 * HOUR, kind: "opened", message: "Declared manually after a customer report.", actor: "Priya Raman" },
      {
        atAgoMs: 4.6 * HOUR,
        kind: "status",
        message: "Status changed from Investigating to Identified.",
        actor: "Priya Raman",
      },
      {
        atAgoMs: 3.2 * HOUR,
        kind: "note",
        message: "Reindex throttled to 40% and lag is falling steadily. Watching for one more cycle.",
        actor: "Priya Raman",
      },
      {
        atAgoMs: 3 * HOUR,
        kind: "status",
        message: "Status changed from Identified to Monitoring.",
        actor: "Priya Raman",
      },
    ],
  },
  {
    orgId: "org_acme",
    key: "INC-2408",
    title: "Notifications — webhook delivery backlog",
    summary:
      "The outbound webhook queue grew past 40k messages after a downstream customer endpoint began timing out. " +
      "No data loss; delivery is delayed.",
    serviceId: "notifications",
    severity: "warning",
    status: "investigating",
    assigneeId: null,
    startedAgoMs: 2.4 * HOUR,
    resolvedAgoMs: null,
    ruleId: null,
    impactedRequests: 41_180,
    timeline: [
      {
        atAgoMs: 2.4 * HOUR,
        kind: "opened",
        message: "Queue depth alarm fired on the notifications worker pool.",
        actor: null,
      },
    ],
  },
  {
    orgId: "org_acme",
    key: "INC-2405",
    title: "Postgres Primary — CPU saturation above 85%",
    summary:
      "A missing index on events(organisation_id, created_at) drove sequential scans during the hourly rollup.",
    serviceId: "postgres-primary",
    severity: "major",
    status: "resolved",
    assigneeId: "usr_marco",
    startedAgoMs: 22 * HOUR,
    resolvedAgoMs: 19.5 * HOUR,
    ruleId: "rule_cpu_warning",
    impactedRequests: 96_400,
    timeline: [
      {
        atAgoMs: 22 * HOUR,
        kind: "opened",
        message: "Rule “CPU saturation above 85%” breached for 5 consecutive samples.",
        actor: null,
      },
      {
        atAgoMs: 21 * HOUR,
        kind: "note",
        message: "Concurrent index created; rollup query dropped from 41 s to 380 ms.",
        actor: "Marco Bellini",
      },
      {
        atAgoMs: 19.5 * HOUR,
        kind: "status",
        message: "Status changed from Monitoring to Resolved.",
        actor: "Marco Bellini",
      },
    ],
  },
  {
    orgId: "org_acme",
    key: "INC-2402",
    title: "Auth Service — token refresh latency spike",
    summary: "JWKS cache stampede after a key rotation pushed p99 refresh latency to 2.4 s for 12 minutes.",
    serviceId: "auth-service",
    severity: "critical",
    status: "resolved",
    assigneeId: "usr_tomas",
    startedAgoMs: 2.1 * DAY,
    resolvedAgoMs: 2.1 * DAY - 38 * MINUTE,
    ruleId: "rule_p99_major",
    impactedRequests: 310_500,
    timeline: [
      {
        atAgoMs: 2.1 * DAY,
        kind: "opened",
        message: "Rule “p99 latency above 900 ms” breached for 4 consecutive samples.",
        actor: null,
      },
      {
        atAgoMs: 2.1 * DAY - 38 * MINUTE,
        kind: "status",
        message: "Status changed from Monitoring to Resolved. Single-flight added around the JWKS fetch.",
        actor: "Tomás Herrera",
      },
    ],
  },
  {
    orgId: "org_acme",
    key: "INC-2398",
    title: "Payments — settlement webhook retries",
    summary: "The PSP returned 502 on 4% of settlement callbacks for 25 minutes. All retried successfully.",
    serviceId: "payments",
    severity: "warning",
    status: "resolved",
    assigneeId: "usr_priya",
    startedAgoMs: 4.3 * DAY,
    resolvedAgoMs: 4.3 * DAY - 25 * MINUTE,
    ruleId: null,
    impactedRequests: 3_820,
    timeline: [
      { atAgoMs: 4.3 * DAY, kind: "opened", message: "Declared manually from the PSP status page.", actor: "Priya Raman" },
      {
        atAgoMs: 4.3 * DAY - 25 * MINUTE,
        kind: "status",
        message: "Status changed from Monitoring to Resolved. Provider confirmed recovery.",
        actor: "Priya Raman",
      },
    ],
  },

  /* --- Stark Industries (staging) — deliberately a different picture ----- */
  {
    orgId: "org_stark",
    key: "INC-0117",
    title: "Auth Service — staging OIDC discovery 404",
    summary:
      "The staging identity provider stopped serving /.well-known/openid-configuration after a tenant rename, " +
      "so every staging sign-in fails at discovery.",
    serviceId: "auth-service",
    severity: "critical",
    status: "investigating",
    assigneeId: "usr_nina",
    startedAgoMs: 38 * MINUTE,
    resolvedAgoMs: null,
    ruleId: null,
    impactedRequests: 1_240,
    timeline: [
      {
        atAgoMs: 38 * MINUTE,
        kind: "opened",
        message: "Declared manually after the staging smoke suite went red.",
        actor: "Nina Kovač",
      },
    ],
  },
  {
    orgId: "org_stark",
    key: "INC-0114",
    title: "Search Index — staging reindex never completes",
    summary: "The nightly staging reindex has been stuck at 61% for nine hours; the worker holds its lock and never yields.",
    serviceId: "search-index",
    severity: "warning",
    status: "monitoring",
    assigneeId: null,
    startedAgoMs: 9 * HOUR,
    resolvedAgoMs: null,
    ruleId: null,
    impactedRequests: 0,
    timeline: [
      { atAgoMs: 9 * HOUR, kind: "opened", message: "Reindex watchdog fired.", actor: null },
      {
        atAgoMs: 8.2 * HOUR,
        kind: "status",
        message: "Status changed from Investigating to Identified.",
        actor: "Nina Kovač",
      },
      {
        atAgoMs: 7 * HOUR,
        kind: "status",
        message: "Status changed from Identified to Monitoring.",
        actor: "Nina Kovač",
      },
    ],
  },
  {
    orgId: "org_stark",
    key: "INC-0109",
    title: "Notifications — staging SMTP sandbox rejected batch",
    summary: "The sandbox mail provider rate-limited a 5k message batch. Staging only; no customer impact.",
    serviceId: "notifications",
    severity: "warning",
    status: "resolved",
    assigneeId: "usr_nina",
    startedAgoMs: 3 * DAY,
    resolvedAgoMs: 3 * DAY - 44 * MINUTE,
    ruleId: null,
    impactedRequests: 5_000,
    timeline: [
      { atAgoMs: 3 * DAY, kind: "opened", message: "Batch send returned 429 for every message.", actor: null },
      {
        atAgoMs: 3 * DAY - 44 * MINUTE,
        kind: "status",
        message: "Status changed from Monitoring to Resolved. Batch size lowered to 500.",
        actor: "Nina Kovač",
      },
    ],
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Integrations                                                                */
/* -------------------------------------------------------------------------- */

const INTEGRATIONS: readonly Omit<SeedIntegration, "credential">[] = [
  {
    id: "int_acme_slack",
    orgId: "org_acme",
    provider: "slack",
    name: "#incidents",
    targetUrl: "https://hooks.slack.com/services/TDEMOTEAM/BDEMOCHAN/replace-with-your-own-webhook",
    enabled: true,
    events: ["incident.opened", "incident.status_changed", "incident.resolved"],
    minSeverity: "warning",
  },
  {
    id: "int_acme_pagerduty",
    orgId: "org_acme",
    provider: "pagerduty",
    name: "Platform primary rotation",
    targetUrl: "https://events.eu.pagerduty.com/v2/enqueue",
    enabled: true,
    events: ["incident.opened", "incident.resolved", "alert.triggered"],
    minSeverity: "critical",
  },
  {
    id: "int_acme_statuspage",
    orgId: "org_acme",
    provider: "webhook",
    name: "Status page sync",
    targetUrl: "https://status.vortex-ops.example/hooks/incidents",
    enabled: true,
    events: ["incident.opened", "incident.status_changed", "incident.resolved"],
    minSeverity: "major",
  },
  {
    id: "int_stark_discord",
    orgId: "org_stark",
    provider: "discord",
    name: "#staging-alerts",
    // Placeholder: the shape is right, the id is not a real channel. Nothing is
    // delivered anywhere until somebody pastes their own webhook URL.
    targetUrl: "https://discord.com/api/webhooks/000000000000000000/replace-with-your-own-webhook",
    enabled: false,
    events: ["incident.opened", "alert.triggered"],
    minSeverity: "warning",
  },
  {
    id: "int_stark_telegram",
    orgId: "org_stark",
    provider: "telegram",
    targetUrl: "https://api.telegram.org",
    name: "Staging on-call bot",
    enabled: false,
    events: ["incident.opened", "incident.resolved"],
    minSeverity: "major",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Maintenance windows                                                        */
/* -------------------------------------------------------------------------- */

interface SeedMaintenanceWindow {
  readonly orgId: string;
  readonly title: string;
  readonly description: string;
  readonly serviceIds: readonly string[];
  /** Negative = already started. */
  readonly startsInMs: number;
  readonly endsInMs: number;
}

const MAINTENANCE_WINDOWS: readonly SeedMaintenanceWindow[] = [
  {
    orgId: "org_acme",
    title: "Postgres primary — replica failover rehearsal",
    description:
      "Planned failover from the primary to the standby replica to validate the new automated runbook. " +
      "Brief write unavailability expected during the switch.",
    serviceIds: ["postgres-primary", "auth-service"],
    startsInMs: 2 * DAY,
    endsInMs: 2 * DAY + 90 * MINUTE,
  },
  {
    orgId: "org_acme",
    title: "API Gateway — TLS certificate rotation",
    description: "Routine certificate rotation on the edge load balancers. No expected customer impact.",
    serviceIds: ["api-gateway"],
    startsInMs: -3 * DAY,
    endsInMs: -3 * DAY + 20 * MINUTE,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Materialises every fixture against one clock.
 *
 * `now` is an argument rather than a call to `Date.now()` inside so the same
 * bundle can be produced identically in a test, and so every relative label in
 * the UI is derived from a single instant.
 */
export async function buildSeed(now: number): Promise<SeedBundle> {
  assertDemoPasswordIsSafe();

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const users: StoredUser[] = USERS.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    passwordHash,
  }));

  const memberships: SeedMembership[] = USERS.flatMap((user) =>
    user.memberships.map((membership) => ({
      userId: user.id,
      orgId: membership.orgId,
      role: membership.role,
      status: membership.status,
      rotation: membership.rotation,
      lastSeenAt: membership.lastSeenAgoMs === null ? null : Math.round(now - membership.lastSeenAgoMs),
    })),
  );

  const incidents = INCIDENTS.map((incident) => ({
    // The public id *is* the per-tenant key. The database keeps its own opaque
    // primary key; what travels through the API, the URLs and the compliance
    // exports is the identifier a human reads out over a call.
    id: incident.key,
    orgId: incident.orgId,
    title: incident.title,
    summary: incident.summary,
    serviceId: incident.serviceId,
    severity: incident.severity,
    status: incident.status,
    assigneeId: incident.assigneeId,
    startedAt: Math.round(now - incident.startedAgoMs),
    resolvedAt: incident.resolvedAgoMs === null ? null : Math.round(now - incident.resolvedAgoMs),
    ruleId: incident.ruleId,
    impactedRequests: incident.impactedRequests,
    timeline: incident.timeline.map((event, index) => ({
      id: `${incident.key}_evt_${index}`,
      at: Math.round(now - event.atAgoMs),
      kind: event.kind,
      message: event.message,
      actor: event.actor,
    })),
  }));

  const integrations: SeedIntegration[] = INTEGRATIONS.map((integration) => ({
    ...integration,
    credential: null,
  }));

  const maintenanceWindows = MAINTENANCE_WINDOWS.map((window, index) => ({
    id: `mw_seed_${index}`,
    orgId: window.orgId,
    title: window.title,
    description: window.description,
    serviceIds: [...window.serviceIds],
    startsAt: Math.round(now + window.startsInMs),
    endsAt: Math.round(now + window.endsInMs),
    cancelledAt: null,
    createdAt: Math.round(now - 6 * HOUR),
  }));

  return { organizations: ORGANIZATIONS, users, memberships, incidents, integrations, maintenanceWindows };
}
