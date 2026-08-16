import type { ServiceDefinition, ServiceTier } from "@/types";

/**
 * The monitored estate.
 *
 * Baselines are what "normal" looks like for each service — the simulator walks
 * around them and the alert rules are written relative to them, so a threshold
 * that makes sense for the search index does not page someone about Postgres.
 */
export const SERVICES: readonly ServiceDefinition[] = [
  {
    id: "api-gateway",
    name: "API Gateway",
    tier: "edge",
    owner: "Platform",
    baseline: { latencyMs: 118, cpuPct: 42, errorRatePct: 0.08, throughputRps: 8_400 },
  },
  {
    id: "auth-service",
    name: "Auth Service",
    tier: "core",
    owner: "Identity",
    baseline: { latencyMs: 74, cpuPct: 31, errorRatePct: 0.04, throughputRps: 3_100 },
  },
  {
    id: "payments",
    name: "Payments",
    tier: "core",
    owner: "Commerce",
    baseline: { latencyMs: 240, cpuPct: 48, errorRatePct: 0.12, throughputRps: 940 },
  },
  {
    id: "search-index",
    name: "Search Index",
    tier: "data",
    owner: "Discovery",
    baseline: { latencyMs: 186, cpuPct: 63, errorRatePct: 0.21, throughputRps: 2_250 },
  },
  {
    id: "postgres-primary",
    name: "Postgres Primary",
    tier: "data",
    owner: "Platform",
    baseline: { latencyMs: 12, cpuPct: 57, errorRatePct: 0.01, throughputRps: 12_800 },
  },
  {
    id: "notifications",
    name: "Notifications",
    tier: "async",
    owner: "Growth",
    baseline: { latencyMs: 410, cpuPct: 22, errorRatePct: 0.35, throughputRps: 620 },
  },
] as const;

const SERVICE_BY_ID = new Map(SERVICES.map((service) => [service.id, service]));

export function getService(id: string): ServiceDefinition | undefined {
  return SERVICE_BY_ID.get(id);
}

/** Service name for display, falling back to the raw id rather than throwing. */
export function serviceName(id: string): string {
  return SERVICE_BY_ID.get(id)?.name ?? id;
}

export const TIER_LABEL: Record<ServiceTier, string> = {
  edge: "Edge",
  core: "Core",
  data: "Data",
  async: "Async",
};

/**
 * Picks one monitored service at random.
 *
 * `rng` defaults to `Math.random` but is accepted as a parameter so the chaos
 * drill is deterministic in tests — a flaky assertion on "which service got
 * picked" would be a test bug, not a product bug.
 */
export function pickRandomService(rng: () => number = Math.random): ServiceDefinition {
  const index = Math.min(Math.floor(rng() * SERVICES.length), SERVICES.length - 1);
  // SERVICES is a non-empty readonly tuple, so this index is always in range.
  return SERVICES[index] as ServiceDefinition;
}
