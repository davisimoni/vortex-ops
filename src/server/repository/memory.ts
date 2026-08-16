import { randomUUID } from "node:crypto";

import type { Permission } from "@/lib/rbac";
import { decryptSecret, encryptSecret, maskCredential } from "@/server/crypto/secrets";
import { buildSeed } from "@/server/seed/fixtures";
import type {
  AuditEntry,
  AuditEvent,
  CredentialBundle,
  IncidentDraft,
  IncidentPatch,
  IntegrationDraftInput,
  IntegrationWithCredential,
  MemberInvite,
  MembershipRecord,
  Organization,
  RoleOverride,
  StoredUser,
  VortexRepository,
  AuditQuery,
} from "@/server/repository/types";
import type {
  DeliveryResult,
  Incident,
  IncidentEvent,
  Integration,
  Role,
  TeamMember,
} from "@/types";

/**
 * In-process storage driver.
 *
 * This is the fallback when no `DATABASE_URL` is configured, and it is a real
 * implementation of the same contract rather than a stub — the credential path
 * encrypts, the audit log is append-only, and every read is filtered by
 * `orgId`. That parity is enforced by a shared contract test suite, so the
 * fallback cannot quietly drift into behaving differently from the database.
 *
 * What it is not: durable. State lives for the lifetime of the process. Said
 * plainly in the UI and at boot, because a fallback that looks like persistence
 * and is not is worse than no fallback at all.
 */

/**
 * `Incident.id` is the per-tenant key (`INC-2411`). Rows are therefore indexed
 * by `orgId:id`, which also makes a cross-tenant lookup structurally impossible
 * rather than merely filtered out afterwards.
 */
interface StoredIncident extends Incident {
  readonly orgId: string;
}

function incidentKey(orgId: string, incidentId: string): string {
  return `${orgId}:${incidentId}`;
}

/** Next free `INC-NNNN` for a tenant, continuing from its highest existing key. */
function nextIncidentId(incidents: Iterable<StoredIncident>, orgId: string): string {
  let highest = 0;
  for (const incident of incidents) {
    if (incident.orgId !== orgId) continue;
    const match = /^INC-(\d+)$/.exec(incident.id);
    if (match?.[1]) highest = Math.max(highest, Number(match[1]));
  }
  return `INC-${String(highest + 1).padStart(4, "0")}`;
}

interface StoredIntegration extends Integration {
  readonly orgId: string;
  readonly credentialCipher: string | null;
}

interface StoredMembership extends MembershipRecord {
  readonly rotation: string | null;
  readonly lastSeenAt: number | null;
  readonly name: string;
  readonly email: string;
}

interface MemoryState {
  organizations: Map<string, Organization>;
  users: Map<string, StoredUser>;
  memberships: StoredMembership[];
  overrides: Map<string, RoleOverride[]>;
  incidents: Map<string, StoredIncident>;
  integrations: Map<string, StoredIntegration>;
  audit: AuditEvent[];
  seeded: boolean;
}

/**
 * Held on `globalThis` so the store survives Next's module reloading in
 * development. Without it every edit silently resets the workspace, and you
 * spend an afternoon chasing "my incident disappeared" bugs that are the dev
 * server, not the code.
 */
const GLOBAL_KEY = Symbol.for("vortex.memory-store");

interface GlobalWithStore {
  [GLOBAL_KEY]?: MemoryState;
}

function emptyState(): MemoryState {
  return {
    organizations: new Map(),
    users: new Map(),
    memberships: [],
    overrides: new Map(),
    incidents: new Map(),
    integrations: new Map(),
    audit: [],
    seeded: false,
  };
}

function state(): MemoryState {
  const globals = globalThis as GlobalWithStore;
  globals[GLOBAL_KEY] ??= emptyState();
  return globals[GLOBAL_KEY];
}

/** Test seam — the store is process-global, so suites must be able to reset it. */
export function resetMemoryStore(): void {
  (globalThis as GlobalWithStore)[GLOBAL_KEY] = emptyState();
}

/** Deep-ish copy on the way out: callers must not be able to mutate the store. */
function cloneIncident(incident: StoredIncident): Incident {
  // `orgId` is dropped explicitly, the same way `toPublicIntegration` drops it
  // below — a plain `{...incident}` spread satisfies the `Incident` return
  // type structurally but does not strip the extra field at runtime, and it
  // would otherwise ride along into every JSON response this repository
  // produces.
  const { orgId: _orgId, ...incidentFields } = incident;
  return {
    ...incidentFields,
    timeline: incident.timeline.map((event) => ({ ...event })),
  };
}

function toPublicIntegration(stored: StoredIntegration): Integration {
  // `credentialCipher` and `orgId` are dropped here rather than in each route:
  // a field the returned object never carries cannot be leaked by forgetting.
  const { credentialCipher: _cipher, orgId: _orgId, ...pub } = stored;
  return { ...pub, events: [...pub.events] };
}

export class MemoryRepository implements VortexRepository {
  readonly driver = "memory" as const;

  async ensureSeeded(): Promise<void> {
    const store = state();
    if (store.seeded) return;
    // Claim the flag before awaiting: two concurrent first requests would
    // otherwise both pass the check and seed the store twice.
    store.seeded = true;

    try {
      const seed = await buildSeed(Date.now());

      for (const org of seed.organizations) store.organizations.set(org.id, org);
      for (const user of seed.users) store.users.set(user.id, user);

      store.memberships = seed.memberships.map((membership) => {
        const user = seed.users.find((entry) => entry.id === membership.userId);
        return {
          ...membership,
          name: user?.name ?? membership.userId,
          email: user?.email ?? "",
        };
      });

      for (const incident of seed.incidents) {
        store.incidents.set(incidentKey(incident.orgId, incident.id), incident as StoredIncident);
      }

      for (const integration of seed.integrations) {
        store.integrations.set(integration.id, {
          id: integration.id,
          orgId: integration.orgId,
          provider: integration.provider,
          name: integration.name,
          targetUrl: integration.targetUrl,
          enabled: integration.enabled,
          events: [...integration.events],
          minSeverity: integration.minSeverity,
          createdAt: Date.now(),
          lastDelivery: null,
          credentialHint: null,
          credentialCipher: null,
        });
      }
    } catch (error) {
      // Leaving `seeded` true on failure would strand an empty store forever.
      store.seeded = false;
      throw error;
    }
  }

  /* Tenancy ------------------------------------------------------------- */

  async listOrganizationsForUser(userId: string): Promise<Organization[]> {
    const store = state();
    return store.memberships
      .filter((membership) => membership.userId === userId && membership.status === "active")
      .map((membership) => store.organizations.get(membership.orgId))
      .filter((org): org is Organization => org !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getOrganization(orgId: string): Promise<Organization | null> {
    return state().organizations.get(orgId) ?? null;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    for (const org of state().organizations.values()) {
      if (org.slug === slug) return org;
    }
    return null;
  }

  /* Auth ---------------------------------------------------------------- */

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const needle = email.trim().toLowerCase();
    for (const user of state().users.values()) {
      if (user.email.toLowerCase() === needle) return { ...user };
    }
    return null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const user = state().users.get(userId);
    return user ? { ...user } : null;
  }

  async getMembership(userId: string, orgId: string): Promise<MembershipRecord | null> {
    const membership = state().memberships.find(
      (entry) => entry.userId === userId && entry.orgId === orgId,
    );
    if (!membership) return null;
    return {
      userId: membership.userId,
      orgId: membership.orgId,
      role: membership.role,
      status: membership.status,
    };
  }

  async touchMembership(userId: string, orgId: string, at: number): Promise<void> {
    const store = state();
    store.memberships = store.memberships.map((membership) =>
      membership.userId === userId && membership.orgId === orgId
        ? { ...membership, lastSeenAt: at }
        : membership,
    );
  }

  /* RBAC ---------------------------------------------------------------- */

  async listRoleOverrides(orgId: string): Promise<RoleOverride[]> {
    return [...(state().overrides.get(orgId) ?? [])];
  }

  async setRoleOverride(
    orgId: string,
    role: Role,
    permission: Permission,
    granted: boolean | null,
  ): Promise<void> {
    const store = state();
    const current = store.overrides.get(orgId) ?? [];
    const without = current.filter(
      (entry) => !(entry.role === role && entry.permission === permission),
    );
    store.overrides.set(orgId, granted === null ? without : [...without, { role, permission, granted }]);
  }

  /* Team ---------------------------------------------------------------- */

  async listMembers(orgId: string): Promise<TeamMember[]> {
    return state()
      .memberships.filter((membership) => membership.orgId === orgId)
      .map((membership) => ({
        id: membership.userId,
        name: membership.name,
        email: membership.email,
        role: membership.role,
        status: membership.status,
        lastActiveAt: membership.lastSeenAt,
        rotation: membership.rotation,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateMemberRole(orgId: string, memberId: string, role: Role): Promise<TeamMember | null> {
    const store = state();
    let updated: TeamMember | null = null;

    store.memberships = store.memberships.map((membership) => {
      if (membership.orgId !== orgId || membership.userId !== memberId) return membership;
      const next = { ...membership, role };
      updated = {
        id: next.userId,
        name: next.name,
        email: next.email,
        role: next.role,
        status: next.status,
        lastActiveAt: next.lastSeenAt,
        rotation: next.rotation,
      };
      return next;
    });

    return updated;
  }

  async inviteMember(orgId: string, invite: MemberInvite): Promise<TeamMember> {
    const store = state();
    const email = invite.email.trim().toLowerCase();

    const existing = await this.findUserByEmail(email);
    const userId = existing?.id ?? `usr_${randomUUID().slice(0, 8)}`;

    if (!existing) {
      store.users.set(userId, {
        id: userId,
        email,
        name: invite.name.trim(),
        // No password yet: an invited account cannot sign in until it sets one.
        passwordHash: "",
      });
    }

    const membership: StoredMembership = {
      userId,
      orgId,
      role: invite.role,
      status: "invited",
      rotation: null,
      lastSeenAt: null,
      name: invite.name.trim(),
      email,
    };

    store.memberships = [...store.memberships, membership];

    return {
      id: userId,
      name: membership.name,
      email: membership.email,
      role: membership.role,
      status: membership.status,
      lastActiveAt: null,
      rotation: null,
    };
  }

  async removeMember(orgId: string, memberId: string): Promise<boolean> {
    const store = state();
    const before = store.memberships.length;
    store.memberships = store.memberships.filter(
      (membership) => !(membership.orgId === orgId && membership.userId === memberId),
    );
    return store.memberships.length < before;
  }

  /* Incidents ------------------------------------------------------------ */

  async listIncidents(orgId: string): Promise<Incident[]> {
    return [...state().incidents.values()]
      .filter((incident) => incident.orgId === orgId)
      .map(cloneIncident)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async getIncident(orgId: string, incidentId: string): Promise<Incident | null> {
    // Keyed by tenant, so an id belonging to another organisation simply does
    // not resolve — "not found", never someone else's incident.
    const incident = state().incidents.get(incidentKey(orgId, incidentId));
    return incident ? cloneIncident(incident) : null;
  }

  async createIncident(orgId: string, draft: IncidentDraft): Promise<Incident> {
    const store = state();
    const id = nextIncidentId(store.incidents.values(), orgId);

    const incident: StoredIncident = {
      id,
      orgId,
      title: draft.title,
      summary: draft.summary,
      serviceId: draft.serviceId,
      severity: draft.severity,
      status: draft.status,
      assigneeId: draft.assigneeId,
      startedAt: draft.startedAt,
      resolvedAt: null,
      ruleId: draft.ruleId,
      impactedRequests: draft.impactedRequests,
      timeline: [{ ...draft.openingEvent, id: `evt_${randomUUID().slice(0, 8)}` }],
    };

    store.incidents.set(incidentKey(orgId, id), incident);
    return cloneIncident(incident);
  }

  async updateIncident(
    orgId: string,
    incidentId: string,
    patch: IncidentPatch,
    event: Omit<IncidentEvent, "id">,
  ): Promise<Incident | null> {
    const store = state();
    const current = store.incidents.get(incidentKey(orgId, incidentId));
    if (!current) return null;

    const next: StoredIncident = {
      ...current,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.assigneeId === undefined ? {} : { assigneeId: patch.assigneeId }),
      ...(patch.resolvedAt === undefined ? {} : { resolvedAt: patch.resolvedAt }),
      timeline: [...current.timeline, { ...event, id: `evt_${randomUUID().slice(0, 8)}` }],
    };

    store.incidents.set(incidentKey(orgId, incidentId), next);
    return cloneIncident(next);
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
    return [...state().integrations.values()]
      .filter((integration) => integration.orgId === orgId)
      .map(toPublicIntegration)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getIntegration(orgId: string, integrationId: string): Promise<Integration | null> {
    const stored = state().integrations.get(integrationId);
    // Integration ids are opaque and globally unique, so the tenant check is an
    // explicit filter rather than a keying scheme.
    if (!stored || stored.orgId !== orgId) return null;
    return toPublicIntegration(stored);
  }

  async getIntegrationWithCredential(
    orgId: string,
    integrationId: string,
  ): Promise<IntegrationWithCredential | null> {
    const stored = state().integrations.get(integrationId);
    if (!stored || stored.orgId !== orgId) return null;

    const credential = stored.credentialCipher
      ? (JSON.parse(decryptSecret(stored.credentialCipher)) as CredentialBundle)
      : null;

    return { integration: toPublicIntegration(stored), credential };
  }

  async createIntegration(
    orgId: string,
    draft: IntegrationDraftInput,
    credential: CredentialBundle | null,
  ): Promise<Integration> {
    const store = state();
    const id = `int_${randomUUID().slice(0, 12)}`;

    const stored: StoredIntegration = {
      id,
      orgId,
      provider: draft.provider,
      name: draft.name.trim(),
      targetUrl: draft.targetUrl.trim(),
      enabled: draft.enabled,
      events: [...draft.events],
      minSeverity: draft.minSeverity,
      createdAt: Date.now(),
      lastDelivery: null,
      credentialHint: credential?.token ? maskCredential(credential.token) : null,
      credentialCipher: credential ? encryptSecret(JSON.stringify(credential)) : null,
    };

    store.integrations.set(id, stored);
    return toPublicIntegration(stored);
  }

  async updateIntegration(
    orgId: string,
    integrationId: string,
    patch: Partial<IntegrationDraftInput>,
    credential: CredentialBundle | null,
  ): Promise<Integration | null> {
    const store = state();
    const current = store.integrations.get(integrationId);
    if (!current || current.orgId !== orgId) return null;

    const next: StoredIntegration = {
      ...current,
      ...(patch.provider === undefined ? {} : { provider: patch.provider }),
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.targetUrl === undefined ? {} : { targetUrl: patch.targetUrl.trim() }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.events === undefined ? {} : { events: [...patch.events] }),
      ...(patch.minSeverity === undefined ? {} : { minSeverity: patch.minSeverity }),
      // A null credential means "leave what is stored alone", not "erase it" —
      // the browser never receives the secret, so it cannot send it back on an
      // ordinary edit, and an edit must not silently disconnect the channel.
      ...(credential === null
        ? {}
        : {
            credentialCipher: encryptSecret(JSON.stringify(credential)),
            credentialHint: credential.token ? maskCredential(credential.token) : null,
          }),
    };

    store.integrations.set(integrationId, next);
    return toPublicIntegration(next);
  }

  async deleteIntegration(orgId: string, integrationId: string): Promise<boolean> {
    const store = state();
    const current = store.integrations.get(integrationId);
    if (!current || current.orgId !== orgId) return false;
    store.integrations.delete(integrationId);
    return true;
  }

  async recordDelivery(
    orgId: string,
    integrationId: string,
    result: DeliveryResult,
  ): Promise<void> {
    const store = state();
    const current = store.integrations.get(integrationId);
    if (!current || current.orgId !== orgId) return;
    store.integrations.set(integrationId, { ...current, lastDelivery: result });
  }

  /* Audit ---------------------------------------------------------------- */

  async appendAudit(entry: AuditEntry): Promise<AuditEvent> {
    const event: AuditEvent = { ...entry, id: `aud_${randomUUID()}`, at: Date.now() };
    state().audit.push(event);
    return event;
  }

  async listAudit(orgId: string, query: AuditQuery = {}): Promise<AuditEvent[]> {
    const { limit = 200, since, until, action } = query;

    /*
     * `at` alone is not a reliable sort key: `Date.now()` has millisecond
     * resolution, and an incident create immediately followed by its own
     * audit-triggered side effects can genuinely land in the same
     * millisecond. `state().audit` is always pushed to in true chronological
     * order, so its index is used as the tiebreaker — later insertion sorts
     * first, matching "newest first" even when two timestamps tie.
     */
    return state()
      .audit.map((event, index) => ({ event, index }))
      .filter(({ event }) => {
        if (event.orgId !== orgId) return false;
        if (since !== undefined && event.at < since) return false;
        if (until !== undefined && event.at > until) return false;
        if (action !== undefined && event.action !== action) return false;
        return true;
      })
      .sort((a, b) => b.event.at - a.event.at || b.index - a.index)
      .slice(0, limit)
      .map(({ event }) => event);
  }
}
