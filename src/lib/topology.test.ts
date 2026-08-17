import { describe, expect, it } from "vitest";

import { SERVICES } from "@/lib/services";
import { computeTopologyLayout, deriveTopologyStatus, TOPOLOGY_EDGES } from "@/lib/topology";
import type { Incident, MetricPoint } from "@/types";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "INC-0001",
    title: "Test incident",
    summary: "",
    serviceId: "api-gateway",
    severity: "warning",
    status: "investigating",
    assigneeId: null,
    startedAt: Date.now(),
    resolvedAt: null,
    ruleId: null,
    impactedRequests: 0,
    timeline: [],
    ...overrides,
  };
}

const SAMPLE: MetricPoint = {
  t: Date.now(),
  latencyP50: 90,
  latencyP95: 200,
  latencyP99: 300,
  cpu: 40,
  errorRate: 0.2,
  throughput: 5_000,
};

describe("computeTopologyLayout", () => {
  const layout = computeTopologyLayout(SERVICES);

  it("puts every service in the layout exactly once", () => {
    expect(layout).toHaveLength(SERVICES.length);
    expect(new Set(layout.map((entry) => entry.serviceId)).size).toBe(SERVICES.length);
  });

  it("places api-gateway (no incoming edge) at level 0", () => {
    const gateway = layout.find((entry) => entry.serviceId === "api-gateway");
    expect(gateway?.level).toBe(0);
  });

  it("places every node strictly to the right of everything it depends on", () => {
    const levelOf = new Map(layout.map((entry) => [entry.serviceId, entry.level]));
    for (const edge of TOPOLOGY_EDGES) {
      const fromLevel = levelOf.get(edge.from);
      const toLevel = levelOf.get(edge.to);
      expect(fromLevel).not.toBeUndefined();
      expect(toLevel).not.toBeUndefined();
      expect(toLevel as number).toBeGreaterThan(fromLevel as number);
    }
  });

  it("places postgres-primary (three incoming edges) after all three of its dependencies", () => {
    const levelOf = new Map(layout.map((entry) => [entry.serviceId, entry.level]));
    const dependants = TOPOLOGY_EDGES.filter((edge) => edge.to === "postgres-primary").map((edge) => edge.from);
    const postgresLevel = levelOf.get("postgres-primary") as number;
    for (const dependant of dependants) {
      expect(postgresLevel).toBeGreaterThan(levelOf.get(dependant) as number);
    }
  });

  it("indexes nodes within a level starting at zero, consistent with levelSize", () => {
    const byLevel = new Map<number, number>();
    for (const entry of layout) byLevel.set(entry.level, (byLevel.get(entry.level) ?? 0) + 1);

    for (const entry of layout) {
      expect(entry.indexInLevel).toBeGreaterThanOrEqual(0);
      expect(entry.indexInLevel).toBeLessThan(entry.levelSize);
      expect(entry.levelSize).toBe(byLevel.get(entry.level));
    }
  });

  it("does not infinite-loop on a cyclic edge set — falls back to treating a re-visited node as a root", () => {
    const cyclic = [{ from: "a", to: "b" } as const, { from: "b", to: "a" } as const];
    const services = [
      { id: "a", name: "A", tier: "core" as const, owner: "x", baseline: { latencyMs: 1, cpuPct: 1, errorRatePct: 1, throughputRps: 1 } },
      { id: "b", name: "B", tier: "core" as const, owner: "x", baseline: { latencyMs: 1, cpuPct: 1, errorRatePct: 1, throughputRps: 1 } },
    ];
    expect(() => computeTopologyLayout(services, cyclic)).not.toThrow();
  });
});

describe("deriveTopologyStatus", () => {
  it("is operational for a service with no open incidents", () => {
    const [status] = deriveTopologyStatus([SERVICES[0] as (typeof SERVICES)[number]], [], null);
    expect(status?.health).toBe("operational");
    expect(status?.openIncidentCount).toBe(0);
  });

  it("derives health from the worst open incident on that service only", () => {
    const gateway = SERVICES.find((service) => service.id === "api-gateway");
    if (!gateway) throw new Error("fixture drift: api-gateway missing from SERVICES");

    const incidents = [
      incident({ serviceId: "api-gateway", severity: "critical", status: "investigating" }),
      // Resolved: must not count toward health or the open count.
      incident({ id: "INC-0002", serviceId: "api-gateway", severity: "critical", status: "resolved" }),
      // A different service entirely: must not leak onto this node's health.
      incident({ id: "INC-0003", serviceId: "auth-service", severity: "critical", status: "investigating" }),
    ];

    const [status] = deriveTopologyStatus([gateway], incidents, null);
    expect(status?.health).toBe("major");
    expect(status?.openIncidentCount).toBe(1);
  });

  it("falls back to the service's own baseline when there is no live sample yet", () => {
    const gateway = SERVICES.find((service) => service.id === "api-gateway");
    if (!gateway) throw new Error("fixture drift: api-gateway missing from SERVICES");

    const [status] = deriveTopologyStatus([gateway], [], null);
    expect(status?.latencyMsEstimate).toBe(gateway.baseline.latencyMs);
    expect(status?.errorRatePctEstimate).toBe(gateway.baseline.errorRatePct);
  });

  it("scales the live sample differently per service, proportional to its own baseline", () => {
    const statuses = deriveTopologyStatus(SERVICES, [], SAMPLE);
    const values = new Set(statuses.map((status) => status.latencyMsEstimate));
    // Six services with different baselines must not collapse to one number —
    // that would mean the "per service" estimate is not actually per service.
    expect(values.size).toBeGreaterThan(1);
  });

  it("returns exactly one status per input service, in the same order", () => {
    const statuses = deriveTopologyStatus(SERVICES, [], SAMPLE);
    expect(statuses.map((status) => status.serviceId)).toEqual(SERVICES.map((service) => service.id));
  });
});
