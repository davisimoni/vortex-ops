import { SEVERITY_TIER, worstTier } from "@/lib/status-page";
import type { HealthTier, Incident, MetricPoint, ServiceDefinition } from "@/types";

/**
 * The service dependency graph — pure data and pure derivations, no I/O, the
 * same split `lib/status-page.ts` uses and for the same reason: the layout
 * and health-derivation logic is testable without a database and impossible
 * for a route to bypass by accident.
 *
 * The edges are a fixed, hand-authored topology rather than anything inferred
 * at runtime — this product has no service mesh or trace pipeline to derive a
 * real dependency graph from, and a topology that silently reshuffled itself
 * between renders would be a worse demo than one that is honestly static.
 */

export interface TopologyEdge {
  readonly from: string;
  readonly to: string;
}

export const TOPOLOGY_EDGES: readonly TopologyEdge[] = [
  { from: "api-gateway", to: "auth-service" },
  { from: "api-gateway", to: "payments" },
  { from: "api-gateway", to: "search-index" },
  { from: "auth-service", to: "postgres-primary" },
  { from: "payments", to: "postgres-primary" },
  { from: "payments", to: "notifications" },
  { from: "search-index", to: "postgres-primary" },
] as const;

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export interface TopologyNodePosition {
  readonly serviceId: string;
  /** Column, left to right — 0 is a root with no incoming edge. */
  readonly level: number;
  /** Position within its column, top to bottom. */
  readonly indexInLevel: number;
  readonly levelSize: number;
}

/**
 * Layers every service by its longest path from a root (a node with no
 * incoming edge), so a node always renders strictly to the right of
 * everything it depends on — the one property that makes a dependency
 * diagram readable at a glance instead of just a bag of connected circles.
 *
 * Deterministic and order-preserving: two services tied on level keep the
 * order they appear in `services`, so the layout does not jitter between
 * renders of the same input.
 */
export function computeTopologyLayout(
  services: readonly ServiceDefinition[],
  edges: readonly TopologyEdge[] = TOPOLOGY_EDGES,
): TopologyNodePosition[] {
  const incoming = new Map<string, string[]>();
  for (const service of services) incoming.set(service.id, []);
  for (const edge of edges) {
    incoming.get(edge.to)?.push(edge.from);
  }

  const level = new Map<string, number>();
  const levelOf = (serviceId: string, guard: ReadonlySet<string> = new Set()): number => {
    const cached = level.get(serviceId);
    if (cached !== undefined) return cached;
    // A cycle would recurse forever; treat a node re-visited mid-resolution as
    // a root rather than looping — this topology is hand-authored and
    // acyclic, so this only guards against a future edit introducing one.
    if (guard.has(serviceId)) return 0;

    const predecessors = incoming.get(serviceId) ?? [];
    const computed =
      predecessors.length === 0
        ? 0
        : 1 + Math.max(...predecessors.map((id) => levelOf(id, new Set([...guard, serviceId]))));

    level.set(serviceId, computed);
    return computed;
  };

  for (const service of services) levelOf(service.id);

  const countByLevel = new Map<number, number>();
  const indexByLevel = new Map<number, number>();
  for (const service of services) {
    const lvl = level.get(service.id) ?? 0;
    countByLevel.set(lvl, (countByLevel.get(lvl) ?? 0) + 1);
  }

  return services.map((service) => {
    const lvl = level.get(service.id) ?? 0;
    const indexInLevel = indexByLevel.get(lvl) ?? 0;
    indexByLevel.set(lvl, indexInLevel + 1);
    return { serviceId: service.id, level: lvl, indexInLevel, levelSize: countByLevel.get(lvl) ?? 1 };
  });
}

/* -------------------------------------------------------------------------- */
/* Live status                                                                 */
/* -------------------------------------------------------------------------- */

export interface TopologyNodeStatus {
  readonly serviceId: string;
  readonly name: string;
  readonly tier: ServiceDefinition["tier"];
  readonly owner: string;
  readonly health: HealthTier;
  readonly openIncidentCount: number;
  /** Estimated from the org's live sample, scaled by this service's baseline — see the module doc. */
  readonly latencyMsEstimate: number;
  readonly errorRatePctEstimate: number;
}

/** Baseline ratio used to scale the one real live sample per service — never a second random source. */
function baselineRatio(
  services: readonly ServiceDefinition[],
  serviceId: string,
  pick: (service: ServiceDefinition) => number,
): number {
  const service = services.find((entry) => entry.id === serviceId);
  if (!service || services.length === 0) return 1;
  const average = services.reduce((sum, entry) => sum + pick(entry), 0) / services.length;
  return average === 0 ? 1 : pick(service) / average;
}

/**
 * Health and a per-service telemetry estimate for every node.
 *
 * `health` is derived entirely from real, persisted incidents — the same
 * `SEVERITY_TIER`/`worstTier` the public status page uses, so a node reads
 * red for the same reason the status page would say "Major outage" for that
 * service. It carries no invented data.
 *
 * `latencyMsEstimate`/`errorRatePctEstimate` are a deterministic scaling of
 * the dashboard's own live sample (already disclosed as simulated telemetry —
 * see the README) by this service's baseline relative to the fleet average.
 * Not a second, independent fabrication: if there is no live sample yet, the
 * service's own baseline is used directly, which is real, authored data.
 */
export function deriveTopologyStatus(
  services: readonly ServiceDefinition[],
  incidents: readonly Incident[],
  latestSample: MetricPoint | null,
): TopologyNodeStatus[] {
  return services.map((service) => {
    const open = incidents.filter(
      (incident) => incident.serviceId === service.id && incident.status !== "resolved",
    );
    const health = worstTier(open.map((incident) => SEVERITY_TIER[incident.severity]));

    const latencyRatio = baselineRatio(services, service.id, (entry) => entry.baseline.latencyMs);
    const errorRatio = baselineRatio(services, service.id, (entry) => entry.baseline.errorRatePct);

    return {
      serviceId: service.id,
      name: service.name,
      tier: service.tier,
      owner: service.owner,
      health,
      openIncidentCount: open.length,
      latencyMsEstimate: Math.round(
        latestSample ? latestSample.latencyP95 * latencyRatio : service.baseline.latencyMs,
      ),
      errorRatePctEstimate:
        Math.round((latestSample ? latestSample.errorRate * errorRatio : service.baseline.errorRatePct) * 100) /
        100,
    };
  });
}
