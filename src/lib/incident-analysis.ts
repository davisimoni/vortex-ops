import { formatDuration } from "@/lib/format";
import { incidentDuration } from "@/lib/incidents";
import type { Incident, IncidentSeverity } from "@/types";

/**
 * Root-cause assistant — a deterministic diagnostic engine, not a live model
 * call.
 *
 * Framed in the product as "AI Root Cause Summary" because that is the
 * category of feature it is (pattern-matched diagnosis + suggested
 * remediation, the same shape AIOps tooling in this space actually ships),
 * but it does not claim to be a specific external LLM and it makes no network
 * call — wiring a real one in is a legitimate future seam (see the STT
 * pattern this author uses elsewhere: agnostic behind an env var, a clear 503
 * without one), not something to fake with a spinner and static copy. What
 * runs here is real in the sense that matters for a demo: every field is
 * actually computed from *this* incident's service, severity and duration,
 * so two different incidents get two different, traceable analyses rather
 * than one block of text copy-pasted regardless of input.
 */

export interface RemediationCommand {
  readonly label: string;
  readonly command: string;
}

export interface RootCauseAnalysis {
  readonly headline: string;
  readonly explanation: string;
  /** 0–100. Higher severity and a longer-running incident read as higher confidence. */
  readonly confidencePct: number;
  readonly commands: readonly [RemediationCommand, RemediationCommand];
}

interface ServiceProfile {
  readonly headline: string;
  readonly cause: string;
  readonly commands: readonly [RemediationCommand, RemediationCommand];
}

const SERVICE_PROFILES: Record<string, ServiceProfile> = {
  "postgres-primary": {
    headline: "High DB Connection Pool Exhaustion",
    cause:
      "the connection pool in front of Postgres Primary is saturated, likely from a slow query holding " +
      "connections open under load",
    commands: [
      { label: "Scale the pooler", command: "kubectl scale deployment/postgres-pgbouncer --replicas=6" },
      {
        label: "Kill long-idle connections",
        command:
          "psql -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND now() - state_change > interval '10 minutes';\"",
      },
    ],
  },
  "api-gateway": {
    headline: "Upstream Timeout Cascade at the Edge",
    cause: "a downstream dependency is timing out and the gateway is queuing retries faster than it can drain them",
    commands: [
      { label: "Restart the gateway fleet", command: "kubectl rollout restart deployment/api-gateway" },
      {
        label: "Raise the circuit-breaker threshold",
        command: "kubectl set env deployment/api-gateway CIRCUIT_BREAKER_ERROR_THRESHOLD=0.25",
      },
    ],
  },
  "auth-service": {
    headline: "Token Validation Latency from JWKS Cache Miss",
    cause: "a recent signing-key rotation caused a cache stampede on JWKS lookups during token validation",
    commands: [
      { label: "Flush the JWKS cache", command: "kubectl exec deploy/auth-service -- auth-cli cache:flush --key=jwks" },
      { label: "Restart auth-service", command: "kubectl rollout restart deployment/auth-service" },
    ],
  },
  payments: {
    headline: "Retry Storm from Downstream Gateway 5xx",
    cause: "the payment service provider is returning 5xx on a share of requests and client retries are amplifying load",
    commands: [
      { label: "Widen the retry backoff", command: "kubectl set env deployment/payments RETRY_BACKOFF_MS=2000" },
      { label: "Scale the payments fleet", command: "kubectl scale deployment/payments --replicas=8" },
    ],
  },
  "search-index": {
    headline: "Index Shard Rebalancing Saturating I/O",
    cause: "a shard rebalance is competing with query traffic for disk I/O on the search cluster",
    commands: [
      {
        label: "Raise the disk watermark",
        command:
          "curl -XPUT localhost:9200/_cluster/settings -d '{\"transient\":{\"cluster.routing.allocation.disk.watermark.low\":\"90%\"}}'",
      },
      { label: "Force a synced flush", command: "curl -XPOST localhost:9200/_flush/synced" },
    ],
  },
  notifications: {
    headline: "Consumer Lag on the Notification Queue",
    cause: "worker throughput has fallen behind the publish rate and the outbound queue is backing up",
    commands: [
      { label: "Scale the worker pool", command: "kubectl scale deployment/notifications-worker --replicas=10" },
      {
        label: "Reset stalled consumer offsets",
        command:
          "kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group notifications --reset-offsets --to-latest --execute",
      },
    ],
  },
};

const FALLBACK_PROFILE: ServiceProfile = {
  headline: "Resource Saturation Under Sustained Load",
  cause: "sustained load has pushed a resource on this service past its normal operating range",
  commands: [
    { label: "Restart the affected deployment", command: "kubectl rollout restart deployment/<service>" },
    { label: "Check recent deploys", command: "kubectl rollout history deployment/<service>" },
  ],
};

const SEVERITY_CONFIDENCE_BASE: Record<IncidentSeverity, number> = {
  critical: 84,
  major: 68,
  warning: 52,
};

/**
 * A small, stable hash of the incident id — not `Math.random()`.
 *
 * The confidence figure has to vary across incidents (a static number would
 * read as decoration, not analysis) while staying identical across renders
 * and across a unit test's repeated calls — the same determinism discipline
 * `mulberry32` gives the metric simulator in `lib/metrics.ts`.
 */
function stableJitter(id: string, spread: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % (spread * 2 + 1)) - spread;
}

export function analyzeIncident(incident: Incident, now: number = Date.now()): RootCauseAnalysis {
  const profile = SERVICE_PROFILES[incident.serviceId] ?? FALLBACK_PROFILE;
  const duration = incidentDuration(incident, now);
  const durationLabel = formatDuration(duration);

  const source =
    incident.ruleId === null
      ? "declared manually"
      : "opened automatically after a sustained threshold breach";

  const explanation =
    `${incident.title} has been ${incident.status === "resolved" ? "open for" : "running for"} ${durationLabel} ` +
    `(${source}), affecting ${incident.impactedRequests.toLocaleString("en-US")} requests. The pattern is ` +
    `consistent with ${profile.cause}.`;

  const base = SEVERITY_CONFIDENCE_BASE[incident.severity];
  const durationBoost = Math.min(10, Math.floor(duration / (10 * 60_000)));
  const confidencePct = Math.max(30, Math.min(97, base + durationBoost + stableJitter(incident.id, 6)));

  return {
    headline: profile.headline,
    explanation,
    confidencePct,
    commands: profile.commands,
  };
}
