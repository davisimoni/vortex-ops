import type { Permission } from "@/lib/rbac";
import { decryptSecret, encryptSecret, maskCredential } from "@/server/crypto/secrets";
import { buildSeed } from "@/server/seed/fixtures";
import type {
  AuditEntry,
  AuditEvent,
  AuditQuery,
  CredentialBundle,
  IncidentDraft,
  IncidentPatch,
  IntegrationDraftInput,
  IntegrationWithCredential,
  MemberInvite,
  MembershipRecord,
  OrgEnvironment,
  Organization,
  RoleOverride,
  StoredUser,
  VortexRepository,
} from "@/server/repository/types";
import type {
  DeliveryResult,
  Incident,
  IncidentEvent,
  IncidentSeverity,
  IncidentStatus,
  Integration,
  IntegrationProvider,
  MemberStatus,
  Role,
  TeamMember,
  WebhookEvent,
} from "@/types";

/**
 * Prisma storage driver.
 *
 * The interesting work here is at the boundary, not in the queries: the schema
 * stores unions as `String` and structures as JSON-in-`String` so one set of
 * models runs on both SQLite and Postgres. Every value is therefore narrowed on
 * the way out. A row written by a migration, a psql session, or an older
 * release of this code can hold anything, and the rest of the application is
 * typed as though it cannot — so this file is where that assumption is actually
 * made true.
 */

/* -------------------------------------------------------------------------- */
/* Narrowing                                                                   */
/* -------------------------------------------------------------------------- */

const ROLES: readonly string[] = ["owner", "devops", "viewer"];
const MEMBER_STATUSES: readonly string[] = ["active", "invited", "suspended"];
const SEVERITIES: readonly string[] = ["critical", "major", "warning"];
const STATUSES: readonly string[] = ["investigating", "identified", "monitoring", "resolved"];
const PROVIDERS: readonly string[] = [
  "slack",
  "pagerduty",
  "discord",
  "telegram",
  "email",
  "webhook",
];
const EVENT_KINDS: readonly string[] = [
  "opened",
  "status",
  "assignment",
  "note",
  "notification",
];
const WEBHOOK_EVENTS: readonly string[] = [
  "incident.opened",
  "incident.status_changed",
  "incident.assigned",
  "incident.resolved",
  "alert.triggered",
];
const ENVIRONMENTS: readonly string[] = ["production", "staging", "development"];

function asRole(value: string): Role {
  return ROLES.includes(value) ? (value as Role) : "viewer";
}
function asMemberStatus(value: string): MemberStatus {
  return MEMBER_STATUSES.includes(value) ? (value as MemberStatus) : "suspended";
}
function asSeverity(value: string): IncidentSeverity {
  return SEVERITIES.includes(value) ? (value as IncidentSeverity) : "warning";
}
function asStatus(value: string): IncidentStatus {
  return STATUSES.includes(value) ? (value as IncidentStatus) : "investigating";
}
function asProvider(value: string): IntegrationProvider {
  return PROVIDERS.includes(value) ? (value as IntegrationProvider) : "webhook";
}
function asEventKind(value: string): IncidentEvent["kind"] {
  return EVENT_KINDS.includes(value) ? (value as IncidentEvent["kind"]) : "note";
}
function asEnvironment(value: string): OrgEnvironment {
  return ENVIRONMENTS.includes(value) ? (value as OrgEnvironment) : "production";
}

/**
 * Unknown roles fall back to `viewer` and unknown statuses to `suspended` —
 * always the *least* privileged interpretation. A corrupted row must never
 * decode into more access than it was meant to carry.
 */
function parseWebhookEvents(raw: string): WebhookEvent[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is WebhookEvent =>
      typeof entry === "string" && WEBHOOK_EVENTS.includes(entry),
    );
  } catch {
    return [];
  }
}

function parseDelivery(raw: string | null): DeliveryResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.ok !== "boolean" || typeof candidate.at !== "number") return null;
    return {
      ok: candidate.ok,
      at: candidate.at,
      status: typeof candidate.status === "number" ? candidate.status : null,
      durationMs: typeof candidate.durationMs === "number" ? candidate.durationMs : 0,
      detail: typeof candidate.detail === "string" ? candidate.detail : "",
    };
  } catch {
    return null;
  }
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Structural row types rather than the generated Prisma types.
 *
 * `@prisma/client` is imported dynamically (see `client.ts`) so a missing or
 * ungenerated client degrades to the memory driver instead of breaking the
 * build. That means the generated types are not statically available here, and
 * a hand-written structural shape is the honest alternative — it is checked
 * against the schema by the contract test suite running on a real database.
 */
interface IncidentRow {
  id: string;
  orgId: string;
  key: string;
  title: string;
  summary: string;
  serviceId: string;
  severity: string;
  status: string;
  assigneeId: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
  ruleId: string | null;
  impactedRequests: number;
  events?: IncidentEventRow[];
}

interface IncidentEventRow {
  id: string;
  at: Date;
  kind: string;
  message: string;
  actor: string | null;
}

interface IntegrationRow {
  id: string;
  orgId: string;
  provider: string;
  name: string;
  targetUrl: string;
  enabled: boolean;
  events: string;
  minSeverity: string;
  credentialCipher: string | null;
  credentialHint: string | null;
  lastDelivery: string | null;
  createdAt: Date;
}

interface MembershipRow {
  userId: string;
  orgId: string;
  role: string;
  status: string;
  rotation: string | null;
  lastSeenAt: Date | null;
  user?: { id: string; name: string; email: string };
}

/* eslint-disable @typescript-eslint/no-explicit-any --
 * The dynamically imported client has no static type here, by design (see the
 * comment on the row shapes above). Delegates are `any` at this single seam and
 * every value that crosses it is narrowed by the helpers above. */
type Delegate = any;
type Client = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.key,
    title: row.title,
    summary: row.summary,
    serviceId: row.serviceId,
    severity: asSeverity(row.severity),
    status: asStatus(row.status),
    assigneeId: row.assigneeId,
    startedAt: row.startedAt.getTime(),
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    ruleId: row.ruleId,
    impactedRequests: row.impactedRequests,
    timeline: (row.events ?? [])
      .map((event) => ({
        id: event.id,
        at: event.at.getTime(),
        kind: asEventKind(event.kind),
        message: event.message,
        actor: event.actor,
      }))
      .sort((a, b) => a.at - b.at),
  };
}

function toIntegration(row: IntegrationRow): Integration {
  return {
    id: row.id,
    provider: asProvider(row.provider),
    name: row.name,
    targetUrl: row.targetUrl,
    enabled: row.enabled,
    events: parseWebhookEvents(row.events),
    minSeverity: asSeverity(row.minSeverity),
    createdAt: row.createdAt.getTime(),
    lastDelivery: parseDelivery(row.lastDelivery),
    credentialHint: row.credentialHint,
  };
}

function toTeamMember(row: MembershipRow): TeamMember {
  return {
    id: row.userId,
    name: row.user?.name ?? row.userId,
    email: row.user?.email ?? "",
    role: asRole(row.role),
    status: asMemberStatus(row.status),
    lastActiveAt: row.lastSeenAt?.getTime() ?? null,
    rotation: row.rotation,
  };
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

export class PrismaRepository implements VortexRepository {
  readonly driver = "prisma" as const;

  constructor(private readonly client: Client) {}

  private get org(): Delegate {
    return this.client.organization;
  }
  private get user(): Delegate {
    return this.client.user;
  }
  private get membership(): Delegate {
    return this.client.membership;
  }
  private get incident(): Delegate {
    return this.client.incident;
  }
  private get integration(): Delegate {
    return this.client.integration;
  }
  private get audit(): Delegate {
    return this.client.auditEvent;
  }
  private get rolePermission(): Delegate {
    return this.client.rolePermission;
  }

  async ensureSeeded(): Promise<void> {
    if (process.env.VORTEX_SKIP_SEED === "1") return;

    const existing: number = await this.org.count();
    if (existing > 0) return;

    const seed = await buildSeed(Date.now());

    // One transaction: a half-seeded database — organisations but no users — is
    // harder to recover from than an empty one, because `count() > 0` above
    // would then skip seeding forever.
    await this.client.$transaction(async (tx: Client) => {
      for (const org of seed.organizations) {
        await tx.organization.create({
          data: {
            id: org.id,
            slug: org.slug,
            name: org.name,
            environment: org.environment,
            metricSeed: org.metricSeed,
          },
        });
      }

      for (const user of seed.users) {
        await tx.user.create({
          data: {
            id: user.id,
            email: user.email,
            name: user.name,
            passwordHash: user.passwordHash,
          },
        });
      }

      for (const membership of seed.memberships) {
        await tx.membership.create({
          data: {
            userId: membership.userId,
            orgId: membership.orgId,
            role: membership.role,
            status: membership.status,
            rotation: membership.rotation,
            lastSeenAt: membership.lastSeenAt === null ? null : new Date(membership.lastSeenAt),
          },
        });
      }

      for (const incident of seed.incidents) {
        await tx.incident.create({
          data: {
            orgId: incident.orgId,
            key: incident.id,
            title: incident.title,
            summary: incident.summary,
            serviceId: incident.serviceId,
            severity: incident.severity,
            status: incident.status,
            assigneeId: incident.assigneeId,
            startedAt: new Date(incident.startedAt),
            resolvedAt: incident.resolvedAt === null ? null : new Date(incident.resolvedAt),
            ruleId: incident.ruleId,
            impactedRequests: incident.impactedRequests,
            events: {
              create: incident.timeline.map((event) => ({
                at: new Date(event.at),
                kind: event.kind,
                message: event.message,
                actor: event.actor,
              })),
            },
          },
        });
      }

      for (const integration of seed.integrations) {
        await tx.integration.create({
          data: {
            id: integration.id,
            orgId: integration.orgId,
            provider: integration.provider,
            name: integration.name,
            targetUrl: integration.targetUrl,
            enabled: integration.enabled,
            events: JSON.stringify(integration.events),
            minSeverity: integration.minSeverity,
          },
        });
      }
    });
  }

  /* Tenancy ------------------------------------------------------------- */

  async listOrganizationsForUser(userId: string): Promise<Organization[]> {
    const rows: Array<{ org: { id: string; slug: string; name: string; environment: string; metricSeed: number } }> =
      await this.membership.findMany({
        where: { userId, status: "active" },
        include: { org: true },
        orderBy: { org: { name: "asc" } },
      });

    return rows.map((row) => ({
      id: row.org.id,
      slug: row.org.slug,
      name: row.org.name,
      environment: asEnvironment(row.org.environment),
      metricSeed: row.org.metricSeed,
    }));
  }

  async getOrganization(orgId: string): Promise<Organization | null> {
    const row = await this.org.findUnique({ where: { id: orgId } });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      environment: asEnvironment(row.environment),
      metricSeed: row.metricSeed,
    };
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    const row = await this.org.findUnique({ where: { slug } });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      environment: asEnvironment(row.environment),
      metricSeed: row.metricSeed,
    };
  }

  /* Auth ---------------------------------------------------------------- */

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const row = await this.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    return row
      ? { id: row.id, email: row.email, name: row.name, passwordHash: row.passwordHash }
      : null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const row = await this.user.findUnique({ where: { id: userId } });
    return row
      ? { id: row.id, email: row.email, name: row.name, passwordHash: row.passwordHash }
      : null;
  }

  async getMembership(userId: string, orgId: string): Promise<MembershipRecord | null> {
    const row = await this.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (!row) return null;
    return {
      userId: row.userId,
      orgId: row.orgId,
      role: asRole(row.role),
      status: asMemberStatus(row.status),
    };
  }

  async touchMembership(userId: string, orgId: string, at: number): Promise<void> {
    await this.membership.updateMany({
      where: { userId, orgId },
      data: { lastSeenAt: new Date(at) },
    });
  }

  /* RBAC ---------------------------------------------------------------- */

  async listRoleOverrides(orgId: string): Promise<RoleOverride[]> {
    const rows: Array<{ role: string; permission: string; granted: boolean }> =
      await this.rolePermission.findMany({ where: { orgId } });

    return rows.map((row) => ({
      role: asRole(row.role),
      permission: row.permission as Permission,
      granted: row.granted,
    }));
  }

  async setRoleOverride(
    orgId: string,
    role: Role,
    permission: Permission,
    granted: boolean | null,
  ): Promise<void> {
    if (granted === null) {
      await this.rolePermission.deleteMany({ where: { orgId, role, permission } });
      return;
    }

    await this.rolePermission.upsert({
      where: { orgId_role_permission: { orgId, role, permission } },
      create: { orgId, role, permission, granted },
      update: { granted },
    });
  }

  /* Team ---------------------------------------------------------------- */

  async listMembers(orgId: string): Promise<TeamMember[]> {
    const rows: MembershipRow[] = await this.membership.findMany({
      where: { orgId },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    });
    return rows.map(toTeamMember);
  }

  async updateMemberRole(orgId: string, memberId: string, role: Role): Promise<TeamMember | null> {
    const updated: number = (
      await this.membership.updateMany({ where: { orgId, userId: memberId }, data: { role } })
    ).count;
    if (updated === 0) return null;

    const row: MembershipRow | null = await this.membership.findUnique({
      where: { userId_orgId: { userId: memberId, orgId } },
      include: { user: true },
    });
    return row ? toTeamMember(row) : null;
  }

  async inviteMember(orgId: string, invite: MemberInvite): Promise<TeamMember> {
    const email = invite.email.trim().toLowerCase();
    const name = invite.name.trim();

    // An invited account has no password hash: it exists so the membership can
    // reference it, and it cannot sign in until one is set.
    const user = await this.user.upsert({
      where: { email },
      create: { email, name, passwordHash: "" },
      update: {},
    });

    const row: MembershipRow = await this.membership.create({
      data: { userId: user.id, orgId, role: invite.role, status: "invited" },
      include: { user: true },
    });

    return toTeamMember(row);
  }

  async removeMember(orgId: string, memberId: string): Promise<boolean> {
    const result = await this.membership.deleteMany({ where: { orgId, userId: memberId } });
    return result.count > 0;
  }

  /* Incidents ------------------------------------------------------------ */

  async listIncidents(orgId: string): Promise<Incident[]> {
    const rows: IncidentRow[] = await this.incident.findMany({
      where: { orgId },
      include: { events: { orderBy: { at: "asc" } } },
      orderBy: { startedAt: "desc" },
    });
    return rows.map(toIncident);
  }

  async getIncident(orgId: string, incidentId: string): Promise<Incident | null> {
    const row: IncidentRow | null = await this.incident.findUnique({
      where: { orgId_key: { orgId, key: incidentId } },
      include: { events: { orderBy: { at: "asc" } } },
    });
    return row ? toIncident(row) : null;
  }

  async createIncident(orgId: string, draft: IncidentDraft): Promise<Incident> {
    // The per-tenant key is derived from the current maximum. Under concurrent
    // creation the unique constraint on [orgId, key] is what actually protects
    // us — this only picks a sensible candidate.
    const latest: { key: string } | null = await this.incident.findFirst({
      where: { orgId },
      orderBy: { key: "desc" },
      select: { key: true },
    });

    const match = latest ? /^INC-(\d+)$/.exec(latest.key) : null;
    const next = match?.[1] ? Number(match[1]) + 1 : 1;
    const key = `INC-${String(next).padStart(4, "0")}`;

    const row: IncidentRow = await this.incident.create({
      data: {
        orgId,
        key,
        title: draft.title,
        summary: draft.summary,
        serviceId: draft.serviceId,
        severity: draft.severity,
        status: draft.status,
        assigneeId: draft.assigneeId,
        startedAt: new Date(draft.startedAt),
        ruleId: draft.ruleId,
        impactedRequests: draft.impactedRequests,
        events: {
          create: [
            {
              at: new Date(draft.openingEvent.at),
              kind: draft.openingEvent.kind,
              message: draft.openingEvent.message,
              actor: draft.openingEvent.actor,
            },
          ],
        },
      },
      include: { events: { orderBy: { at: "asc" } } },
    });

    return toIncident(row);
  }

  async updateIncident(
    orgId: string,
    incidentId: string,
    patch: IncidentPatch,
    event: Omit<IncidentEvent, "id">,
  ): Promise<Incident | null> {
    const existing: { id: string } | null = await this.incident.findUnique({
      where: { orgId_key: { orgId, key: incidentId } },
      select: { id: true },
    });
    if (!existing) return null;

    // The status change and its timeline entry are one write. A transition
    // recorded without its event, or vice versa, produces a post-mortem that
    // does not match the incident.
    const row: IncidentRow = await this.incident.update({
      where: { id: existing.id },
      data: {
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.assigneeId === undefined ? {} : { assigneeId: patch.assigneeId }),
        ...(patch.resolvedAt === undefined
          ? {}
          : { resolvedAt: patch.resolvedAt === null ? null : new Date(patch.resolvedAt) }),
        events: {
          create: [
            {
              at: new Date(event.at),
              kind: event.kind,
              message: event.message,
              actor: event.actor,
            },
          ],
        },
      },
      include: { events: { orderBy: { at: "asc" } } },
    });

    return toIncident(row);
  }

  async appendIncidentEvent(
    orgId: string,
    incidentId: string,
    event: Omit<IncidentEvent, "id">,
  ): Promise<Incident | null> {
    return this.updateIncident(orgId, incidentId, {}, event);
  }

  /* Integrations --------------------------------------------------------- */

  async listIntegrations(orgId: string): Promise<Integration[]> {
    const rows: IntegrationRow[] = await this.integration.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toIntegration);
  }

  async getIntegration(orgId: string, integrationId: string): Promise<Integration | null> {
    const row: IntegrationRow | null = await this.integration.findFirst({
      where: { id: integrationId, orgId },
    });
    return row ? toIntegration(row) : null;
  }

  async getIntegrationWithCredential(
    orgId: string,
    integrationId: string,
  ): Promise<IntegrationWithCredential | null> {
    const row: IntegrationRow | null = await this.integration.findFirst({
      where: { id: integrationId, orgId },
    });
    if (!row) return null;

    const credential = row.credentialCipher
      ? (JSON.parse(decryptSecret(row.credentialCipher)) as CredentialBundle)
      : null;

    return { integration: toIntegration(row), credential };
  }

  async createIntegration(
    orgId: string,
    draft: IntegrationDraftInput,
    credential: CredentialBundle | null,
  ): Promise<Integration> {
    const row: IntegrationRow = await this.integration.create({
      data: {
        orgId,
        provider: draft.provider,
        name: draft.name.trim(),
        targetUrl: draft.targetUrl.trim(),
        enabled: draft.enabled,
        events: JSON.stringify(draft.events),
        minSeverity: draft.minSeverity,
        credentialCipher: credential ? encryptSecret(JSON.stringify(credential)) : null,
        credentialHint: credential?.token ? maskCredential(credential.token) : null,
      },
    });
    return toIntegration(row);
  }

  async updateIntegration(
    orgId: string,
    integrationId: string,
    patch: Partial<IntegrationDraftInput>,
    credential: CredentialBundle | null,
  ): Promise<Integration | null> {
    const existing: { id: string } | null = await this.integration.findFirst({
      where: { id: integrationId, orgId },
      select: { id: true },
    });
    if (!existing) return null;

    const row: IntegrationRow = await this.integration.update({
      where: { id: existing.id },
      data: {
        ...(patch.provider === undefined ? {} : { provider: patch.provider }),
        ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
        ...(patch.targetUrl === undefined ? {} : { targetUrl: patch.targetUrl.trim() }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.events === undefined ? {} : { events: JSON.stringify(patch.events) }),
        ...(patch.minSeverity === undefined ? {} : { minSeverity: patch.minSeverity }),
        // A null credential leaves the stored one alone. The browser never
        // receives the secret, so it cannot echo it back on an ordinary edit —
        // and an edit must not silently disconnect the channel.
        ...(credential === null
          ? {}
          : {
              credentialCipher: encryptSecret(JSON.stringify(credential)),
              credentialHint: credential.token ? maskCredential(credential.token) : null,
            }),
      },
    });

    return toIntegration(row);
  }

  async deleteIntegration(orgId: string, integrationId: string): Promise<boolean> {
    const result = await this.integration.deleteMany({ where: { id: integrationId, orgId } });
    return result.count > 0;
  }

  async recordDelivery(
    orgId: string,
    integrationId: string,
    result: DeliveryResult,
  ): Promise<void> {
    await this.integration.updateMany({
      where: { id: integrationId, orgId },
      data: { lastDelivery: JSON.stringify(result) },
    });
  }

  /* Audit ---------------------------------------------------------------- */

  async appendAudit(entry: AuditEntry): Promise<AuditEvent> {
    const row = await this.audit.create({
      data: {
        orgId: entry.orgId,
        actorId: entry.actorId,
        actorName: entry.actorName,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        outcome: entry.outcome,
        metadata: JSON.stringify(entry.metadata),
        ip: entry.ip,
      },
    });

    return {
      id: row.id,
      at: row.at.getTime(),
      orgId: row.orgId,
      actorId: row.actorId,
      actorName: row.actorName,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      outcome: row.outcome as AuditEvent["outcome"],
      metadata: parseMetadata(row.metadata),
      ip: row.ip,
    };
  }

  async listAudit(orgId: string, query: AuditQuery = {}): Promise<AuditEvent[]> {
    const { limit = 200, since, until, action } = query;

    const rows = await this.audit.findMany({
      where: {
        orgId,
        ...(action === undefined ? {} : { action }),
        ...(since === undefined && until === undefined
          ? {}
          : {
              at: {
                ...(since === undefined ? {} : { gte: new Date(since) }),
                ...(until === undefined ? {} : { lte: new Date(until) }),
              },
            }),
      },
      orderBy: { at: "desc" },
      take: Math.min(limit, 5_000),
    });

    return rows.map(
      (row: {
        id: string;
        at: Date;
        orgId: string;
        actorId: string | null;
        actorName: string;
        action: string;
        targetType: string;
        targetId: string | null;
        outcome: string;
        metadata: string;
        ip: string | null;
      }) => ({
        id: row.id,
        at: row.at.getTime(),
        orgId: row.orgId,
        actorId: row.actorId,
        actorName: row.actorName,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        outcome: row.outcome as AuditEvent["outcome"],
        metadata: parseMetadata(row.metadata),
        ip: row.ip,
      }),
    );
  }
}
