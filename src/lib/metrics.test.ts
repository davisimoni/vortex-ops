import { describe, expect, it } from "vitest";

import {
  assessHealth,
  downsample,
  generateSeries,
  getRange,
  healthTier,
  mulberry32,
  nextPoint,
  summarise,
  TIME_RANGES,
} from "@/lib/metrics";
import type { MetricPoint } from "@/types";

const BASE: MetricPoint = {
  t: 1_700_000_000_000,
  latencyP50: 90,
  latencyP95: 190,
  latencyP99: 270,
  cpu: 40,
  errorRate: 0.05,
  throughput: 7_500,
};

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
  });

  it("stays inside [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("generateSeries", () => {
  it("produces the point count declared by the range spec", () => {
    for (const range of TIME_RANGES) {
      const series = generateSeries(range.id, { seed: 1, endAt: BASE.t });
      expect(series).toHaveLength(range.points);
    }
  });

  it("is reproducible, which is what lets the server and the client agree", () => {
    const first = generateSeries("24h", { seed: 4_242, endAt: BASE.t });
    const second = generateSeries("24h", { seed: 4_242, endAt: BASE.t });
    expect(first).toEqual(second);
  });

  it("keeps the latency percentiles correctly ordered", () => {
    // Three independent walks would cross, which never happens in real
    // telemetry and instantly reads as fabricated data.
    const series = generateSeries("7d", { seed: 11, endAt: BASE.t });
    for (const point of series) {
      expect(point.latencyP50).toBeLessThanOrEqual(point.latencyP95);
      expect(point.latencyP95).toBeLessThanOrEqual(point.latencyP99);
    }
  });

  it("keeps every metric inside its physical bounds", () => {
    const series = generateSeries("30d", { seed: 3, endAt: BASE.t });
    for (const point of series) {
      expect(point.cpu).toBeGreaterThanOrEqual(0);
      expect(point.cpu).toBeLessThanOrEqual(100);
      expect(point.errorRate).toBeGreaterThanOrEqual(0);
      expect(point.errorRate).toBeLessThanOrEqual(100);
      expect(point.throughput).toBeGreaterThan(0);
      expect(Number.isFinite(point.latencyP99)).toBe(true);
    }
  });

  it("spaces samples on the range's grid", () => {
    const spec = getRange("1h");
    const series = generateSeries("1h", { seed: 5, endAt: BASE.t });
    const first = series[0];
    const second = series[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect((second?.t ?? 0) - (first?.t ?? 0)).toBe(spec.stepMs);
  });
});

describe("nextPoint", () => {
  it("preserves percentile ordering across many steps", () => {
    const rng = mulberry32(21);
    let point = BASE;
    for (let i = 0; i < 300; i += 1) {
      point = nextPoint(point, BASE.t + i * 2_000, rng);
      expect(point.latencyP50).toBeLessThanOrEqual(point.latencyP95);
      expect(point.latencyP95).toBeLessThanOrEqual(point.latencyP99);
      expect(point.cpu).toBeLessThanOrEqual(99);
      expect(point.errorRate).toBeGreaterThanOrEqual(0);
    }
  });

  it("stamps the timestamp it was given", () => {
    const rng = mulberry32(1);
    const next = nextPoint(BASE, 1_234_567, rng);
    expect(next.t).toBe(1_234_567);
  });
});

describe("assessHealth", () => {
  it("returns a perfect score for a healthy sample", () => {
    const health = assessHealth({
      ...BASE,
      errorRate: 0.02,
      latencyP95: 120,
      cpu: 30,
    });
    expect(health.score).toBe(100);
    expect(health.tier).toBe("operational");
    expect(health.driver).toBeNull();
  });

  it("names the error rate as the driver when it dominates", () => {
    const health = assessHealth({ ...BASE, errorRate: 6, latencyP95: 150, cpu: 35 });
    expect(health.driver).toBe("errorRate");
    expect(health.score).toBeLessThan(70);
  });

  it("penalises open critical incidents, capped so they cannot zero the score alone", () => {
    const clean = assessHealth({ ...BASE, errorRate: 0.02, latencyP95: 120, cpu: 30 }, 0);
    const withOne = assessHealth({ ...BASE, errorRate: 0.02, latencyP95: 120, cpu: 30 }, 1);
    const withTen = assessHealth({ ...BASE, errorRate: 0.02, latencyP95: 120, cpu: 30 }, 10);

    expect(withOne.score).toBe(clean.score - 7);
    // The cap is 28, not 70.
    expect(withTen.score).toBe(clean.score - 28);
  });

  it("never leaves the 0–100 range", () => {
    const worst = assessHealth({ ...BASE, errorRate: 100, latencyP95: 9_000, cpu: 100 }, 50);
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it("treats a missing sample as healthy rather than as zero", () => {
    // No data is not the same as "everything is broken"; a fresh dashboard must
    // not open on a red major-outage banner.
    expect(assessHealth(undefined).score).toBe(100);
  });
});

describe("healthTier", () => {
  it.each([
    [100, "operational"],
    [95, "operational"],
    [94, "degraded"],
    [85, "degraded"],
    [84, "partial"],
    [60, "partial"],
    [59, "major"],
    [0, "major"],
  ] as const)("maps %i to %s", (score, tier) => {
    expect(healthTier(score)).toBe(tier);
  });
});

describe("summarise", () => {
  it("returns zeroes for an empty window instead of NaN", () => {
    const summary = summarise([], "cpu");
    expect(summary).toEqual({ current: 0, previous: 0, min: 0, max: 0, avg: 0, deltaPct: 0 });
  });

  it("computes the delta against the earlier half of the window", () => {
    const points: MetricPoint[] = [10, 10, 10, 20].map((cpu, index) => ({
      ...BASE,
      t: BASE.t + index * 1_000,
      cpu,
    }));

    const summary = summarise(points, "cpu");
    expect(summary.current).toBe(20);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(20);
    // Baseline is the mean of the first half (10, 10) → +100%.
    expect(summary.deltaPct).toBe(100);
  });
});

describe("downsample", () => {
  it("leaves a short series untouched", () => {
    const points = generateSeries("1h", { seed: 2, endAt: BASE.t });
    expect(downsample(points, 500)).toHaveLength(points.length);
  });

  it("reduces to at most the requested count and keeps the final point exact", () => {
    const points = generateSeries("7d", { seed: 2, endAt: BASE.t });
    const reduced = downsample(points, 40);

    expect(reduced.length).toBeLessThanOrEqual(40);
    // The chart's end-label has to agree with the stat tile.
    expect(reduced[reduced.length - 1]).toEqual(points[points.length - 1]);
  });
});
