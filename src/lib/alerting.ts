import { formatLatency, formatPercent } from "@/lib/format";
import { serviceName } from "@/lib/services";
import type { AlertEvaluation, AlertRule, MetricKey, MetricPoint } from "@/types";

/**
 * Threshold alerting engine.
 *
 * Pure functions over a window of samples — no timers, no state, no I/O. The
 * store calls `evaluateRules` on every new sample and turns the results into
 * incidents; the unit tests call it with hand-built windows. Same code path.
 */

export const DEFAULT_RULES: readonly AlertRule[] = [
  {
    id: "rule_5xx_critical",
    name: "5xx error rate above 2%",
    metric: "errorRate",
    comparator: "gt",
    threshold: 2,
    forSamples: 3,
    severity: "critical",
    serviceId: "api-gateway",
    enabled: true,
  },
  {
    id: "rule_p99_major",
    name: "p99 latency above 900 ms",
    metric: "latencyP99",
    comparator: "gt",
    threshold: 900,
    forSamples: 4,
    severity: "major",
    serviceId: "api-gateway",
    enabled: true,
  },
  {
    id: "rule_cpu_warning",
    name: "CPU saturation above 85%",
    metric: "cpu",
    comparator: "gt",
    threshold: 85,
    forSamples: 5,
    severity: "warning",
    serviceId: "postgres-primary",
    enabled: true,
  },
  {
    id: "rule_traffic_drop",
    name: "Throughput collapse below 900 rps",
    metric: "throughput",
    comparator: "lt",
    threshold: 900,
    forSamples: 3,
    severity: "major",
    serviceId: "api-gateway",
    enabled: true,
  },
] as const;

function breaches(value: number, rule: AlertRule): boolean {
  return rule.comparator === "gt" ? value > rule.threshold : value < rule.threshold;
}

/**
 * Counts how many of the most recent samples breach, newest first, stopping at
 * the first that does not.
 *
 * The `forSamples` dwell time is what separates an alert from a pager storm: a
 * single 2-second spike over threshold is noise, and firing on it trains people
 * to ignore the pager.
 */
export function consecutiveBreaches(
  points: readonly MetricPoint[],
  rule: AlertRule,
): { count: number; observed: number } {
  let count = 0;
  let observed = 0;

  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    if (!point) break;
    const value = point[rule.metric as MetricKey];
    if (i === points.length - 1) observed = value;
    if (!breaches(value, rule)) break;
    count += 1;
  }

  return { count, observed };
}

export function evaluateRules(
  points: readonly MetricPoint[],
  rules: readonly AlertRule[] = DEFAULT_RULES,
): AlertEvaluation[] {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => {
      const { count, observed } = consecutiveBreaches(points, rule);
      return {
        rule,
        breached: count >= rule.forSamples,
        observed,
        consecutive: count,
      };
    });
}

/** Formats an observed value the way its metric should read. */
export function formatMetricValue(metric: MetricKey, value: number): string {
  switch (metric) {
    case "latencyP50":
    case "latencyP95":
    case "latencyP99":
      return formatLatency(value);
    case "cpu":
    case "errorRate":
      return formatPercent(value, 2);
    case "throughput":
      return `${Math.round(value).toLocaleString("en-US")} rps`;
    default:
      return String(value);
  }
}

export const METRIC_LABEL: Record<MetricKey, string> = {
  latencyP50: "Latency p50",
  latencyP95: "Latency p95",
  latencyP99: "Latency p99",
  cpu: "CPU load",
  errorRate: "5xx error rate",
  throughput: "Throughput",
};

/** The incident title an auto-fired rule produces. */
export function alertTitle(evaluation: AlertEvaluation): string {
  return `${serviceName(evaluation.rule.serviceId)} — ${evaluation.rule.name}`;
}

export function alertSummary(evaluation: AlertEvaluation): string {
  const { rule, observed, consecutive } = evaluation;
  const direction = rule.comparator === "gt" ? "above" : "below";
  return (
    `${METRIC_LABEL[rule.metric]} held ${direction} the ${formatMetricValue(rule.metric, rule.threshold)} ` +
    `threshold for ${consecutive} consecutive samples. Latest reading: ` +
    `${formatMetricValue(rule.metric, observed)}.`
  );
}
