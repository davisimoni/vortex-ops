import { beforeEach, describe, expect, it } from "vitest";

import { MemoryRepository, resetMemoryStore } from "@/server/repository/memory";

/**
 * Exercises the in-process storage driver directly.
 *
 * This is the fallback that keeps `npm run build` and `npm start` working with
 * no database configured at all, and it implements the exact same
 * `VortexRepository` contract Prisma does — so these are also, structurally,
 * tests of the multi-tenancy boundary, the credential-encryption path, and the
 * append-only audit log, independent of which driver is behind them.
 */

let repo: MemoryRepository;

beforeEach(async () => {
  resetMemoryStore();
  repo = new MemoryRepository();
  await repo.ensureSeeded();
});

describe("seeding", () => {
  it("is idempotent — a second call does not duplicate data", async () => {
    const before = await repo.listIncidents("org_acme");
    await repo.ensureSeeded();
    const after = await repo.listIncidents("org_acme");
    expect(after).toHaveLength(before.length);
  });

  it("seeds two organisations with different data, not one org twice under two names", async () => {
    const acme = await repo.listIncidents("org_acme");
    const stark = await repo.listIncidents("org_stark");

    expect(acme.length).toBeGreaterThan(0);
    expect(stark.length).toBeGreaterThan(0);
    expect(acme.map((i) => i.id)).not.toEqual(stark.map((i) => i.id));
  });
});

describe("tenancy", () => {
  it("gives a user only the organisations they have an active membership in", async () => {
    const orgs = await repo.listOrganizationsForUser("usr_ada");
    expect(orgs.map((o) => o.id).sort()).toEqual(["org_acme", "org_stark"]);

    const marcosOrgs = await repo.listOrganizationsForUser("usr_marco");
    expect(marcosOrgs.map((o) => o.id)).toEqual(["org_acme"]);
  });

  it("returns nothing for a user with no memberships", async () => {
    expect(await repo.listOrganizationsForUser("usr_does_not_exist")).toEqual([]);
  });

  it("resolves a role per organisation for the same person", async () => {
    // Ada is Owner at Acme and Viewer at Stark — the same identity, different
    // authority, decided per tenant.
    const atAcme = await repo.getMembership("usr_ada", "org_acme");
    const atStark = await repo.getMembership("usr_ada", "org_stark");

    expect(atAcme?.role).toBe("owner");
    expect(atStark?.role).toBe("viewer");
  });

  it("returns null for a membership that does not exist", async () => {
    expect(await repo.getMembership("usr_marco", "org_stark")).toBeNull();
  });

  it("resolves an organisation by its public slug — the status page's only lookup", async () => {
    const acme = await repo.getOrganizationBySlug("acme-corp");
    expect(acme?.id).toBe("org_acme");

    expect(await repo.getOrganizationBySlug("no-such-org")).toBeNull();
  });
});

describe("incident isolation", () => {
  it("never returns another organisation's incident by id", async () => {
    const [acmeIncident] = await repo.listIncidents("org_acme");
    expect(acmeIncident).toBeDefined();
    if (!acmeIncident) return;

    // The same id, looked up under the wrong tenant, must read as absent.
    expect(await repo.getIncident("org_stark", acmeIncident.id)).toBeNull();
    expect(await repo.getIncident("org_acme", acmeIncident.id)).not.toBeNull();
  });

  it("assigns sequential per-tenant keys that continue from the seed", async () => {
    const before = await repo.listIncidents("org_acme");
    const highest = Math.max(
      ...before.map((incident) => Number(/^INC-(\d+)$/.exec(incident.id)?.[1] ?? 0)),
    );

    const created = await repo.createIncident("org_acme", {
      title: "New incident",
      summary: "Just happened.",
      serviceId: "api-gateway",
      severity: "warning",
      status: "investigating",
      assigneeId: null,
      startedAt: Date.now(),
      ruleId: null,
      impactedRequests: 0,
      openingEvent: { at: Date.now(), kind: "opened", message: "Declared manually.", actor: "Test" },
    });

    expect(Number(/^INC-(\d+)$/.exec(created.id)?.[1] ?? 0)).toBe(highest + 1);
  });

  it("keeps per-tenant numbering independent", async () => {
    const acmeIncident = await repo.createIncident("org_acme", {
      title: "Acme incident",
      summary: "x",
      serviceId: "api-gateway",
      severity: "warning",
      status: "investigating",
      assigneeId: null,
      startedAt: Date.now(),
      ruleId: null,
      impactedRequests: 0,
      openingEvent: { at: Date.now(), kind: "opened", message: "x", actor: "Test" },
    });
    const starkIncident = await repo.createIncident("org_stark", {
      title: "Stark incident",
      summary: "x",
      serviceId: "api-gateway",
      severity: "warning",
      status: "investigating",
      assigneeId: null,
      startedAt: Date.now(),
      ruleId: null,
      impactedRequests: 0,
      openingEvent: { at: Date.now(), kind: "opened", message: "x", actor: "Test" },
    });

    // Acme's seed runs up into the thousands (INC-2411...); Stark's seed is
    // much lower (INC-0117...) — if numbering were shared these would collide
    // or one tenant would leak information about the other's incident volume.
    expect(acmeIncident.id).not.toBe(starkIncident.id);
  });

  it("never leaks the internal orgId field into the public Incident shape", async () => {
    // A plain object spread satisfies the `Incident` return type structurally
    // without stripping extra fields at runtime — this caught a real leak
    // where every incident silently carried its orgId into JSON responses.
    const [acmeIncident] = await repo.listIncidents("org_acme");
    expect(acmeIncident).toBeDefined();
    expect(acmeIncident && "orgId" in acmeIncident).toBe(false);

    const created = await repo.createIncident("org_acme", {
      title: "Leak check",
      summary: "x",
      serviceId: "api-gateway",
      severity: "warning",
      status: "investigating",
      assigneeId: null,
      startedAt: Date.now(),
      ruleId: null,
      impactedRequests: 0,
      openingEvent: { at: Date.now(), kind: "opened", message: "x", actor: "Test" },
    });
    expect("orgId" in created).toBe(false);
  });

  it("records the opening event on the timeline", async () => {
    const created = await repo.createIncident("org_acme", {
      title: "New incident",
      summary: "x",
      serviceId: "payments",
      severity: "critical",
      status: "investigating",
      assigneeId: null,
      startedAt: 1_000,
      ruleId: "rule_5xx_critical",
      impactedRequests: 0,
      openingEvent: {
        at: 1_000,
        kind: "opened",
        message: "Rule breached.",
        actor: null,
      },
    });

    expect(created.timeline).toHaveLength(1);
    expect(created.timeline[0]).toMatchObject({ kind: "opened", actor: null });
  });

  it("appends a timeline event and applies a patch atomically", async () => {
    const [acmeIncident] = await repo.listIncidents("org_acme");
    expect(acmeIncident).toBeDefined();
    if (!acmeIncident) return;

    const before = acmeIncident.timeline.length;
    const updated = await repo.updateIncident(
      "org_acme",
      acmeIncident.id,
      { status: "resolved", resolvedAt: 5_000 },
      { at: 5_000, kind: "status", message: "Resolved in the test.", actor: "Test" },
    );

    expect(updated?.status).toBe("resolved");
    expect(updated?.resolvedAt).toBe(5_000);
    expect(updated?.timeline).toHaveLength(before + 1);
  });

  it("returns null when updating an incident that belongs to a different tenant", async () => {
    const [acmeIncident] = await repo.listIncidents("org_acme");
    expect(acmeIncident).toBeDefined();
    if (!acmeIncident) return;

    const result = await repo.updateIncident(
      "org_stark",
      acmeIncident.id,
      { status: "resolved" },
      { at: 0, kind: "status", message: "x", actor: "Test" },
    );
    expect(result).toBeNull();
  });

  it("appendIncidentEvent adds a note without touching status", async () => {
    const [acmeIncident] = await repo.listIncidents("org_acme");
    expect(acmeIncident).toBeDefined();
    if (!acmeIncident) return;

    const updated = await repo.appendIncidentEvent("org_acme", acmeIncident.id, {
      at: 9_000,
      kind: "note",
      message: "Investigating further.",
      actor: "Test",
    });

    expect(updated?.status).toBe(acmeIncident.status);
    expect(updated?.timeline.at(-1)?.message).toBe("Investigating further.");
  });
});

describe("integrations and credential encryption", () => {
  it("never includes the ciphertext in the public shape", async () => {
    const integration = await repo.createIntegration(
      "org_acme",
      {
        provider: "pagerduty",
        name: "Test route",
        targetUrl: "https://events.eu.pagerduty.com/v2/enqueue",
        enabled: true,
        events: ["incident.opened"],
        minSeverity: "critical",
      },
      { token: "R0SUPERSECRETROUTINGKEY" },
    );

    // No property on the returned object should ever carry the raw or
    // encrypted secret — only a masked hint.
    expect(JSON.stringify(integration)).not.toContain("R0SUPERSECRETROUTINGKEY");
    expect(integration.credentialHint).toBe("••••GKEY");
  });

  it("decrypts the credential correctly for the party that fetches it explicitly", async () => {
    const integration = await repo.createIntegration(
      "org_acme",
      {
        provider: "telegram",
        name: "Bot",
        targetUrl: "https://api.telegram.org",
        enabled: true,
        events: ["incident.opened"],
        minSeverity: "major",
      },
      { token: "123456:AA-bot-token", destination: "-100987654321" },
    );

    const withCredential = await repo.getIntegrationWithCredential("org_acme", integration.id);
    expect(withCredential?.credential).toEqual({
      token: "123456:AA-bot-token",
      destination: "-100987654321",
    });
  });

  it("isolates integrations by tenant", async () => {
    const acme = await repo.createIntegration(
      "org_acme",
      {
        provider: "webhook",
        name: "Acme hook",
        targetUrl: "https://ops.example.com/acme",
        enabled: true,
        events: ["incident.opened"],
        minSeverity: "warning",
      },
      null,
    );

    expect(await repo.getIntegration("org_stark", acme.id)).toBeNull();
    expect(await repo.deleteIntegration("org_stark", acme.id)).toBe(false);
    expect(await repo.getIntegration("org_acme", acme.id)).not.toBeNull();
  });

  it("leaves a stored credential untouched when the update passes null", async () => {
    const created = await repo.createIntegration(
      "org_acme",
      {
        provider: "pagerduty",
        name: "Route",
        targetUrl: "https://events.pagerduty.com/v2/enqueue",
        enabled: true,
        events: ["incident.opened"],
        minSeverity: "critical",
      },
      { token: "original-secret-value" },
    );

    // Simulates an ordinary field edit where the browser never held the
    // secret and so cannot resend it.
    await repo.updateIntegration("org_acme", created.id, { name: "Renamed route" }, null);

    const withCredential = await repo.getIntegrationWithCredential("org_acme", created.id);
    expect(withCredential?.integration.name).toBe("Renamed route");
    expect(withCredential?.credential?.token).toBe("original-secret-value");
  });

  it("rotates the credential when a new one is supplied", async () => {
    const created = await repo.createIntegration(
      "org_acme",
      {
        provider: "pagerduty",
        name: "Route",
        targetUrl: "https://events.pagerduty.com/v2/enqueue",
        enabled: true,
        events: ["incident.opened"],
        minSeverity: "critical",
      },
      { token: "old-token" },
    );

    await repo.updateIntegration("org_acme", created.id, {}, { token: "new-token" });

    const withCredential = await repo.getIntegrationWithCredential("org_acme", created.id);
    expect(withCredential?.credential?.token).toBe("new-token");
  });

  it("records a delivery result scoped to the tenant", async () => {
    const created = await repo.createIntegration(
      "org_acme",
      {
        provider: "slack",
        name: "#test",
        targetUrl: "https://hooks.slack.com/services/T/B/X",
        enabled: true,
        events: ["incident.opened"],
        minSeverity: "warning",
      },
      null,
    );

    await repo.recordDelivery("org_acme", created.id, {
      ok: true,
      at: 123,
      status: 200,
      durationMs: 50,
      detail: "Accepted in 50 ms.",
    });
    // Should be a silent no-op for the wrong tenant, not a cross-tenant write.
    await repo.recordDelivery("org_stark", created.id, {
      ok: false,
      at: 456,
      status: 500,
      durationMs: 10,
      detail: "should not apply",
    });

    const integration = await repo.getIntegration("org_acme", created.id);
    expect(integration?.lastDelivery?.status).toBe(200);
  });
});

describe("RBAC overrides", () => {
  it("starts with no overrides", async () => {
    expect(await repo.listRoleOverrides("org_acme")).toEqual([]);
  });

  it("grants and revokes independently per organisation", async () => {
    await repo.setRoleOverride("org_acme", "viewer", "audit:read", true);
    await repo.setRoleOverride("org_stark", "viewer", "audit:read", false);

    const acmeOverrides = await repo.listRoleOverrides("org_acme");
    const starkOverrides = await repo.listRoleOverrides("org_stark");

    expect(acmeOverrides).toContainEqual({ role: "viewer", permission: "audit:read", granted: true });
    expect(starkOverrides).toContainEqual({ role: "viewer", permission: "audit:read", granted: false });
  });

  it("clears an override back to the default when granted is null", async () => {
    await repo.setRoleOverride("org_acme", "viewer", "audit:read", true);
    await repo.setRoleOverride("org_acme", "viewer", "audit:read", null);

    expect(await repo.listRoleOverrides("org_acme")).toEqual([]);
  });

  it("replaces rather than duplicates an existing override", async () => {
    await repo.setRoleOverride("org_acme", "devops", "team:invite", true);
    await repo.setRoleOverride("org_acme", "devops", "team:invite", false);

    const overrides = await repo.listRoleOverrides("org_acme");
    expect(overrides.filter((o) => o.permission === "team:invite")).toHaveLength(1);
    expect(overrides.find((o) => o.permission === "team:invite")?.granted).toBe(false);
  });
});

describe("team roster", () => {
  it("lists only members of the requested organisation", async () => {
    const acmeMembers = await repo.listMembers("org_acme");
    const starkMembers = await repo.listMembers("org_stark");

    expect(acmeMembers.some((m) => m.id === "usr_marco")).toBe(true);
    expect(starkMembers.some((m) => m.id === "usr_marco")).toBe(false);
  });

  it("shows the same person with their role for that organisation only", async () => {
    const acmeMembers = await repo.listMembers("org_acme");
    const starkMembers = await repo.listMembers("org_stark");

    expect(acmeMembers.find((m) => m.id === "usr_ada")?.role).toBe("owner");
    expect(starkMembers.find((m) => m.id === "usr_ada")?.role).toBe("viewer");
  });

  it("updates a role only within the given organisation", async () => {
    const updated = await repo.updateMemberRole("org_acme", "usr_lena", "devops");
    expect(updated?.role).toBe("devops");

    // Lena has no membership at Stark; the same call there must miss.
    expect(await repo.updateMemberRole("org_stark", "usr_lena", "owner")).toBeNull();
  });

  it("invites a brand-new email as a pending member", async () => {
    const invited = await repo.inviteMember("org_acme", {
      name: "Jordan Blake",
      email: "jordan.blake@example.com",
      role: "viewer",
    });

    expect(invited.status).toBe("invited");
    expect(invited.lastActiveAt).toBeNull();

    const members = await repo.listMembers("org_acme");
    expect(members.some((m) => m.email === "jordan.blake@example.com")).toBe(true);
  });

  it("reuses an existing user record when inviting a known email to a new organisation", async () => {
    // Marco already exists (he's on Acme); inviting him to Stark must not
    // create a second, disconnected user row under the same address.
    const invited = await repo.inviteMember("org_stark", {
      name: "Marco Bellini",
      email: "marco.bellini@vortex-ops.example",
      role: "viewer",
    });

    expect(invited.id).toBe("usr_marco");
  });

  it("removes a member only from the specified organisation", async () => {
    expect(await repo.removeMember("org_stark", "usr_marco")).toBe(false);
    expect(await repo.removeMember("org_acme", "usr_lena")).toBe(true);

    const members = await repo.listMembers("org_acme");
    expect(members.some((m) => m.id === "usr_lena")).toBe(false);
  });
});

describe("audit trail", () => {
  it("is append-only and returns newest first", async () => {
    await repo.appendAudit({
      orgId: "org_acme",
      actorId: "usr_ada",
      actorName: "Ada Okafor",
      action: "incident.create",
      targetType: "incident",
      targetId: "INC-9001",
      outcome: "success",
      metadata: {},
      ip: null,
    });
    await repo.appendAudit({
      orgId: "org_acme",
      actorId: "usr_ada",
      actorName: "Ada Okafor",
      action: "incident.transition",
      targetType: "incident",
      targetId: "INC-9001",
      outcome: "success",
      metadata: {},
      ip: null,
    });

    const events = await repo.listAudit("org_acme");
    expect(events[0]?.action).toBe("incident.transition");
    expect(events[1]?.action).toBe("incident.create");
  });

  it("records denied actions, not only successes", async () => {
    await repo.appendAudit({
      orgId: "org_acme",
      actorId: "usr_lena",
      actorName: "Lena Vogt",
      action: "incident.transition",
      targetType: "incident",
      targetId: "INC-1",
      outcome: "denied",
      metadata: { reason: "insufficient permission" },
      ip: "203.0.113.9",
    });

    const events = await repo.listAudit("org_acme");
    expect(events.some((event) => event.outcome === "denied")).toBe(true);
  });

  it("scopes strictly by organisation", async () => {
    await repo.appendAudit({
      orgId: "org_stark",
      actorId: "usr_nina",
      actorName: "Nina Kovač",
      action: "auth.sign_in",
      targetType: "session",
      targetId: null,
      outcome: "success",
      metadata: {},
      ip: null,
    });

    const acmeEvents = await repo.listAudit("org_acme");
    expect(acmeEvents.some((event) => event.actorName === "Nina Kovač")).toBe(false);
  });

  it("filters by action and respects the limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await repo.appendAudit({
        orgId: "org_acme",
        actorId: "usr_ada",
        actorName: "Ada Okafor",
        action: "integration.test",
        targetType: "integration",
        targetId: null,
        outcome: "success",
        metadata: {},
        ip: null,
      });
    }

    const limited = await repo.listAudit("org_acme", { action: "integration.test", limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited.every((event) => event.action === "integration.test")).toBe(true);
  });
});
