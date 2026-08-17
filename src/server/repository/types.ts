import type { Permission } from "@/lib/rbac";
import type {
  DeliveryResult,
  Incident,
  IncidentEvent,
  IncidentSeverity,
  IncidentStatus,
  Integration,
  IntegrationProvider,
  MaintenanceWindow,
  MemberStatus,
  Role,
  TeamMember,
  WebhookEvent,
} from "@/types";

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                     */
/* -------------------------------------------------------------------------- */

export type OrgEnvironment = "production" | "staging" | "development";

export interface Organization {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly environment: OrgEnvironment;
  /** Seeds the metric simulator so each tenant's telemetry is its own. */
  readonly metricSeed: number;
}

export interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
}

export interface MembershipRecord {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly status: MemberStatus;
}

/* -------------------------------------------------------------------------- */
/* RBAC overrides                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A per-organisation deviation from the built-in role matrix.
 * Absence means "use the default for that role" — the table stores decisions,
 * not a full copy of the matrix, so a change to the defaults reaches every
 * tenant that never customised it.
 */
export interface RoleOverride {
  readonly role: Role;
  readonly permission: Permission;
  readonly granted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

export type AuditOutcome = "success" | "denied" | "failure";

export interface AuditEntry {
  readonly orgId: string;
  readonly actorId: string | null;
  readonly actorName: string;
  /** Dotted verb: `incident.transition`, `integration.trigger`, `auth.sign_in`. */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly outcome: AuditOutcome;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly ip: string | null;
}

export interface AuditEvent extends AuditEntry {
  readonly id: string;
  readonly at: number;
}

export interface AuditQuery {
  readonly limit?: number;
  readonly since?: number;
  readonly until?: number;
  readonly action?: string;
}

/* -------------------------------------------------------------------------- */
/* Write payloads                                                              */
/* -------------------------------------------------------------------------- */

export interface IncidentDraft {
  readonly title: string;
  readonly summary: string;
  readonly serviceId: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly assigneeId: string | null;
  readonly startedAt: number;
  readonly ruleId: string | null;
  readonly impactedRequests: number;
  readonly openingEvent: Omit<IncidentEvent, "id">;
}

export interface IncidentPatch {
  readonly status?: IncidentStatus;
  readonly assigneeId?: string | null;
  readonly resolvedAt?: number | null;
}

export interface IntegrationDraftInput {
  readonly provider: IntegrationProvider;
  readonly name: string;
  readonly targetUrl: string;
  readonly enabled: boolean;
  readonly events: readonly WebhookEvent[];
  readonly minSeverity: IncidentSeverity;
}

/**
 * Credentials travel separately from the record they belong to.
 *
 * Keeping them out of `Integration` means the type the UI receives simply has
 * no field to leak — a route cannot forget to strip a property that was never
 * on the object.
 */
export interface CredentialBundle {
  /** Discord webhook URL, Telegram bot token, PagerDuty routing key. */
  readonly token?: string;
  /** Telegram chat id, or the recipient list for email. */
  readonly destination?: string;
}

export interface IntegrationWithCredential {
  readonly integration: Integration;
  readonly credential: CredentialBundle | null;
}

export interface MemberInvite {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export interface MaintenanceWindowDraft {
  readonly title: string;
  readonly description: string;
  readonly serviceIds: readonly string[];
  readonly startsAt: number;
  readonly endsAt: number;
}

/* -------------------------------------------------------------------------- */
/* The repository                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The storage contract.
 *
 * Every method that touches tenant data takes `orgId` as its first argument.
 * That is the multi-tenancy boundary expressed in the type system: there is no
 * overload that reads an incident without saying whose it is, so a caller
 * cannot forget the filter — the code would not compile.
 *
 * Two drivers implement this: Prisma against a real database, and an in-process
 * store used when no `DATABASE_URL` is configured. They are held to the same
 * contract by one shared test suite (`repository-contract.test.ts`), which is
 * the only way the fallback stays a faithful stand-in rather than slowly
 * becoming a different product.
 */
export interface VortexRepository {
  readonly driver: "prisma" | "memory";

  /** Idempotent. Seeds an empty store; a populated one is left untouched. */
  ensureSeeded(): Promise<void>;

  /* Tenancy ------------------------------------------------------------- */
  listOrganizationsForUser(userId: string): Promise<Organization[]>;
  getOrganization(orgId: string): Promise<Organization | null>;
  /** Looks an organisation up by its public slug — the public status page's only entry point. */
  getOrganizationBySlug(slug: string): Promise<Organization | null>;

  /* Auth ---------------------------------------------------------------- */
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  getMembership(userId: string, orgId: string): Promise<MembershipRecord | null>;
  touchMembership(userId: string, orgId: string, at: number): Promise<void>;

  /* RBAC ---------------------------------------------------------------- */
  listRoleOverrides(orgId: string): Promise<RoleOverride[]>;
  /** `granted: null` clears the override and restores the default. */
  setRoleOverride(
    orgId: string,
    role: Role,
    permission: Permission,
    granted: boolean | null,
  ): Promise<void>;

  /* Team ---------------------------------------------------------------- */
  listMembers(orgId: string): Promise<TeamMember[]>;
  updateMemberRole(orgId: string, memberId: string, role: Role): Promise<TeamMember | null>;
  inviteMember(orgId: string, invite: MemberInvite): Promise<TeamMember>;
  removeMember(orgId: string, memberId: string): Promise<boolean>;

  /* Incidents ------------------------------------------------------------ */
  listIncidents(orgId: string): Promise<Incident[]>;
  getIncident(orgId: string, incidentId: string): Promise<Incident | null>;
  createIncident(orgId: string, draft: IncidentDraft): Promise<Incident>;
  updateIncident(
    orgId: string,
    incidentId: string,
    patch: IncidentPatch,
    event: Omit<IncidentEvent, "id">,
  ): Promise<Incident | null>;
  appendIncidentEvent(
    orgId: string,
    incidentId: string,
    event: Omit<IncidentEvent, "id">,
  ): Promise<Incident | null>;

  /* Integrations --------------------------------------------------------- */
  listIntegrations(orgId: string): Promise<Integration[]>;
  getIntegration(orgId: string, integrationId: string): Promise<Integration | null>;
  /** Decrypts on read. Server-side callers only — never reached from a route response. */
  getIntegrationWithCredential(
    orgId: string,
    integrationId: string,
  ): Promise<IntegrationWithCredential | null>;
  createIntegration(
    orgId: string,
    draft: IntegrationDraftInput,
    credential: CredentialBundle | null,
  ): Promise<Integration>;
  updateIntegration(
    orgId: string,
    integrationId: string,
    patch: Partial<IntegrationDraftInput>,
    credential: CredentialBundle | null,
  ): Promise<Integration | null>;
  deleteIntegration(orgId: string, integrationId: string): Promise<boolean>;
  recordDelivery(orgId: string, integrationId: string, result: DeliveryResult): Promise<void>;

  /* Audit ---------------------------------------------------------------- */
  appendAudit(entry: AuditEntry): Promise<AuditEvent>;
  listAudit(orgId: string, query?: AuditQuery): Promise<AuditEvent[]>;

  /* Maintenance windows ---------------------------------------------------- */
  listMaintenanceWindows(orgId: string): Promise<MaintenanceWindow[]>;
  createMaintenanceWindow(orgId: string, draft: MaintenanceWindowDraft): Promise<MaintenanceWindow>;
  /** `null` if the window does not exist in this organisation. Idempotent — cancelling twice is not an error. */
  cancelMaintenanceWindow(orgId: string, windowId: string): Promise<MaintenanceWindow | null>;
}
