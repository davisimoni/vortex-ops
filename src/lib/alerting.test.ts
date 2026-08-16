import { describe, expect, it } from "vitest";

import {
  alertSummary,
  alertTitle,
  consecutiveBreaches,
  DEFAULT_RULES,
  evaluateRules,
  METRIC_LABEL,
} from "@/lib/alerting";
import type { AlertRule, MetricPoint } from "@/types";

const BASE: MetricPoint = {
  t: 1_700_000_000_000,
  latencyP50: 90,
  latencyP95: 190,
  latencyP99: 270,
  cpu: 40,
  errorRate: 0.05,
  throughput: 7_500,
};

function window(errorRates: readonly number[]): MetricPoint[] {
  return errorRates.map((errorRate, index) => ({
    ...BASE,
    t: BASE.t + index * 2_000,
    errorRate,
  }));
}

const ERROR_RULE: AlertRule = {
  id: "rule_test",
  name: "5xx above 2%",
  metric: "errorRate",
  comparator: "gt",
  threshold: 2,
  forSamples: 3,
  severity: "critical",
  serviceId: "api-gateway",
  enabled: true,
};

describe("consecutiveBreaches", () => {
  it("counts backwards from the newest sample", () => {
    const result = consecutiveBreaches(window([0.1, 0.1, 5, 6, 7]), ERROR_RULE);
    expect(result.count).toBe(3);
    expect(result.observed).toBe(7);
  });

  it("stops at the first sample that recovers", () => {
    // A run that was broken is not a run. Otherwise a metric that flaps over the
    // threshold every other sample would eventually fire on nothing.
    const result = consecutiveBreaches(window([9, 9, 9, 0.1, 9]), ERROR_RULE);
    expect(result.count).toBe(1);
  });

  it("returns zero when the newest sample is healthy", () => {
    expect(consecutiveBreaches(window([9, 9, 9, 0.1]), ERROR_RULE).count).toBe(0);
  });

  it("handles an empty window", () => {
    expect(consecutiveBreaches([], ERROR_RULE)).toEqual({ count: 0, observed: 0 });
  });
});

describe("evaluateRules", () => {
  it("does not fire before the dwell time is satisfied", () => {
    // A single spike over threshold is noise; firing on it is how teams learn
    // to ignore the pager.
    const [evaluation] = evaluateRules(window([0.1, 9, 9]), [ERROR_RULE]);
    expect(evaluation?.breached).toBe(false);
    expect(evaluation?.consecutive).toBe(2);
  });

  it("fires once the dwell time is met", () => {
    const [evaluation] = evaluateRules(window([0.1, 9, 9, 9]), [ERROR_RULE]);
    expect(evaluation?.breached).toBe(true);
    expect(evaluation?.consecutive).toBe(3);
  });

  it("skips disabled rules entirely", () => {
    const evaluations = evaluateRules(window([9, 9, 9, 9]), [{ ...ERROR_RULE, enabled: false }]);
    expect(evaluations).toHaveLength(0);
  });

  it("supports a below-threshold comparator for traffic collapse", () => {
    const collapse: AlertRule = {
      ...ERROR_RULE,
      id: "rule_traffic",
      metric: "throughput",
      comparator: "lt",
      threshold: 900,
      forSamples: 2,
    };

    const points = [5_000, 400, 300].map((throughput, index) => ({
      ...BASE,
      t: BASE.t + index * 2_000,
      throughput,
    }));

    const [evaluation] = evaluateRules(points, [collapse]);
    expect(evaluation?.breached).toBe(true);
    expect(evaluation?.observed).toBe(300);
  });

  it("evaluates every default rule without throwing", () => {
    const evaluations = evaluateRules(window([0.1, 0.1, 0.1]), DEFAULT_RULES);
    expect(evaluations).toHaveLength(DEFAULT_RULES.filter((rule) => rule.enabled).length);
  });
});

describe("alert copy", () => {
  it("names the service and the rule in the title", () => {
    const [evaluation] = evaluateRules(window([9, 9, 9, 9]), [ERROR_RULE]);
    expect(evaluation).toBeDefined();
    if (!evaluation) return;

    expect(alertTitle(evaluation)).toBe("API Gateway — 5xx above 2%");
  });

  it("states the threshold, the dwell count and the latest reading", () => {
    const [evaluation] = evaluateRules(window([9, 9, 9, 4.5]), [ERROR_RULE]);
    expect(evaluation).toBeDefined();
    if (!evaluation) return;

    const summary = alertSummary(evaluation);
    expect(summary).toContain("above");
    expect(summary).toContain("4 consecutive samples");
    expect(summary).toContain("4.50%");
  });

  it("labels every metric key", () => {
    for (const rule of DEFAULT_RULES) {
      expect(METRIC_LABEL[rule.metric]).toBeTruthy();
    }
  });
});
