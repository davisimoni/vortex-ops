import { clamp, normalise, round } from "@/lib/utils";
import type {
  HealthAssessment,
  HealthTier,
  MetricKey,
  MetricPoint,
  TimeRangeId,
  TimeRangeSpec,
} from "@/types";

/* -------------------------------------------------------------------------- */
/* Time ranges                                                                 */
/* -------------------------------------------------------------------------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Point counts are chosen so every range renders roughly the same number of
 * marks. A 30-day window sampled at 1-minute resolution is 43,200 points — the
 * browser would render a smear, not a chart.
 */
export const TIME_RANGES: readonly TimeRangeSpec[] = [
  {
    id: "1h",
    label: "1h",
    description: "Last hour",
    durationMs: HOUR,
    points: 60,
    stepMs: MINUTE,
    tickFormat: "clock",
  },
  {
    id: "24h",
    label: "24h",
    description: "Last 24 hours",
    durationMs: DAY,
    points: 96,
    stepMs: 15 * MINUTE,
    tickFormat: "clock",
  },
  {
    id: "7d",
    label: "7d",
    description: "Last 7 days",
    durationMs: 7 * DAY,
    points: 168,
    stepMs: HOUR,
    tickFormat: "day",
  },
  {
    id: "30d",
    label: "30d",
    description: "Last 30 days",
    durationMs: 30 * DAY,
    points: 120,
    stepMs: 6 * HOUR,
    tickFormat: "day",
  },
] as const;

const RANGE_BY_ID = new Map(TIME_RANGES.map((range) => [range.id, range]));

export function getRange(id: TimeRangeId): TimeRangeSpec {
  const range = RANGE_BY_ID.get(id);
  // The map is built from the same literal union, so this is unreachable —
  // it exists to keep the return type non-optional for every caller.
  if (!range) throw new Error(`Unknown time range: ${id}`);
  return range;
}

/* -------------------------------------------------------------------------- */
/* Deterministic pseudo-randomness                                             */
/* -------------------------------------------------------------------------- */

/**
 * mulberry32 — small, fast, and *seeded*.
 *
 * Determinism is not a nicety here: the same seed must produce the same series
 * in a unit test, on the server, and in the browser. `Math.random()` would make
 * the tests flaky and the first client render differ from the server's.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Box–Muller: turns two uniforms into one standard-normal sample. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* -------------------------------------------------------------------------- */
/* Series generation                                                           */
/* -------------------------------------------------------------------------- */

/** Traffic follows the working day: quiet at 04:00, peaking around 14:00. */
function diurnalFactor(timestamp: number): number {
  const hour = new Date(timestamp).getUTCHours() + new Date(timestamp).getUTCMinutes() / 60;
  return 0.62 + 0.38 * Math.sin(((hour - 4) / 24) * 2 * Math.PI);
}

/**
 * A degradation window: a smooth bump that ramps in, peaks, and decays.
 * Real incidents are not single-sample spikes, and a chart that only ever shows
 * one-pixel spikes teaches the reader nothing about how to read a real one.
 */
function burstFactor(index: number, centre: number, width: number): number {
  const distance = (index - centre) / width;
  return Math.exp(-(distance * distance));
}

export interface SeriesOptions {
  /** Anchors the series so repeated calls with the same seed are identical. */
  readonly seed?: number;
  /** End of the window. Defaults to "now". */
  readonly endAt?: number;
  /** Multiplies the noise and burst amplitude. 0 produces a flat baseline. */
  readonly volatility?: number;
}

/**
 * Generates a full metric series for `range`.
 *
 * The three latency percentiles are derived from one underlying signal so they
 * keep their natural ordering (p50 ≤ p95 ≤ p99) — three independent random
 * walks would cross, which never happens in real telemetry and immediately
 * reads as fake.
 */
export function generateSeries(range: TimeRangeId, options: SeriesOptions = {}): MetricPoint[] {
  const spec = getRange(range);
  const { seed = 42, endAt = Date.now(), volatility = 1 } = options;
  const rng = mulberry32(seed + spec.points);

  // Snap the window to the sample grid so ticks land on round times.
  const alignedEnd = Math.floor(endAt / spec.stepMs) * spec.stepMs;
  const startAt = alignedEnd - (spec.points - 1) * spec.stepMs;

  // Two degradation windows per series, placed deterministically.
  const burstA = { centre: spec.points * (0.28 + rng() * 0.12), width: spec.points * 0.045 };
  const burstB = { centre: spec.points * (0.68 + rng() * 0.14), width: spec.points * 0.03 };

  const points: MetricPoint[] = [];
  // A slow-moving random walk gives the series memory; pure noise looks like static.
  let drift = 0;

  for (let i = 0; i < spec.points; i += 1) {
    const t = startAt + i * spec.stepMs;
    const daylight = diurnalFactor(t);
    drift = clamp(drift * 0.86 + gaussian(rng) * 0.09 * volatility, -0.5, 0.85);

    const stress =
      burstFactor(i, burstA.centre, burstA.width) * 1.9 * volatility +
      burstFactor(i, burstB.centre, burstB.width) * 1.15 * volatility;

    const load = 1 + drift * 0.35 + stress;

    const latencyP50 = round(96 * daylight * load + gaussian(rng) * 6 * volatility, 1);

    /*
     * Tail percentiles amplify load super-linearly — queueing, not a constant
     * offset. Each tail is floored against the percentile below it: the noise
     * term can otherwise push p99 under p95, and a series where the percentiles
     * cross is not noisy telemetry, it is impossible telemetry. The floor is a
     * multiple rather than equality so the three lines stay visually separable.
     */
    const latencyP95 = round(
      Math.max(
        latencyP50 * 1.35,
        latencyP50 * (2.05 + stress * 0.55) + gaussian(rng) * 12 * volatility,
      ),
      1,
    );
    const latencyP99 = round(
      Math.max(
        latencyP95 * 1.12,
        latencyP95 * (1.42 + stress * 0.4) + gaussian(rng) * 20 * volatility,
      ),
      1,
    );

    const cpu = round(clamp(38 * daylight * (1 + stress * 0.55) + drift * 9 + gaussian(rng) * 3.2 * volatility, 2, 99), 1);

    const errorRate = round(
      clamp(0.06 + stress * 1.55 + Math.max(0, gaussian(rng)) * 0.09 * volatility, 0, 42),
      3,
    );

    const throughput = Math.round(
      clamp(7_800 * daylight * (1 - stress * 0.18) + gaussian(rng) * 190 * volatility, 120, 20_000),
    );

    points.push({
      t,
      latencyP50: Math.max(latencyP50, 1),
      latencyP95: Math.max(latencyP95, 2),
      latencyP99: Math.max(latencyP99, 3),
      cpu,
      errorRate,
      throughput,
    });
  }

  return points;
}

/**
 * Produces the next live sample, continuing from `previous`.
 *
 * Each metric reverts toward its baseline while carrying most of its previous
 * value forward, so the live chart moves the way telemetry actually moves
 * instead of jumping to a fresh random value every tick.
 */
export function nextPoint(previous: MetricPoint, at: number, rng: () => number): MetricPoint {
  const daylight = diurnalFactor(at);
  const meanRevert = (current: number, target: number, inertia: number, noise: number): number =>
    current * inertia + target * (1 - inertia) + gaussian(rng) * noise;

  // Roughly one tick in forty kicks the system — enough that a viewer watching
  // the dashboard for a minute sees something happen.
  const shock = rng() < 0.025 ? 1 + rng() * 2.4 : 0;

  const latencyP50 = Math.max(
    8,
    round(meanRevert(previous.latencyP50, 96 * daylight, 0.82, 4) * (1 + shock * 0.5), 1),
  );
  const latencyP95 = Math.max(
    latencyP50 * 1.6,
    round(meanRevert(previous.latencyP95, latencyP50 * 2.1, 0.78, 9) * (1 + shock * 0.7), 1),
  );
  const latencyP99 = Math.max(
    latencyP95 * 1.15,
    round(meanRevert(previous.latencyP99, latencyP95 * 1.45, 0.75, 16) * (1 + shock * 0.9), 1),
  );

  return {
    t: at,
    latencyP50,
    latencyP95,
    latencyP99,
    cpu: round(clamp(meanRevert(previous.cpu, 38 * daylight, 0.9, 1.8) + shock * 11, 2, 99), 1),
    errorRate: round(clamp(meanRevert(previous.errorRate, 0.09, 0.88, 0.05) + shock * 1.4, 0, 42), 3),
    throughput: Math.round(
      clamp(meanRevert(previous.throughput, 7_800 * daylight, 0.9, 140), 120, 20_000),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Health score                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Penalty weights, summing to 100.
 *
 * Error rate dominates because a fast 500 is still a 500: users notice failed
 * requests before they notice slow ones. CPU is weighted lowest — it is a
 * leading indicator, not a symptom the customer feels.
 */
const HEALTH_WEIGHTS = {
  errorRate: 42,
  latencyP95: 34,
  cpu: 24,
} as const;

/** `[good, bad]` bounds per metric: at or below `good` costs nothing. */
const HEALTH_BOUNDS = {
  errorRate: [0.15, 5] as const,
  latencyP95: [220, 900] as const,
  cpu: [55, 95] as const,
};

/** Each unresolved critical incident removes this much, capped below. */
const CRITICAL_INCIDENT_PENALTY = 7;
const MAX_INCIDENT_PENALTY = 28;

export function assessHealth(point: MetricPoint | undefined, openCritical = 0): HealthAssessment {
  if (!point) return { score: 100, tier: "operational", driver: null };

  const penalties: Array<{ key: MetricKey | "incidents"; value: number }> = [
    {
      key: "errorRate",
      value: HEALTH_WEIGHTS.errorRate * normalise(point.errorRate, ...HEALTH_BOUNDS.errorRate),
    },
    {
      key: "latencyP95",
      value: HEALTH_WEIGHTS.latencyP95 * normalise(point.latencyP95, ...HEALTH_BOUNDS.latencyP95),
    },
    { key: "cpu", value: HEALTH_WEIGHTS.cpu * normalise(point.cpu, ...HEALTH_BOUNDS.cpu) },
    {
      key: "incidents",
      value: Math.min(openCritical * CRITICAL_INCIDENT_PENALTY, MAX_INCIDENT_PENALTY),
    },
  ];

  const total = penalties.reduce((sum, entry) => sum + entry.value, 0);
  const score = Math.round(clamp(100 - total, 0, 100));

  const worst = penalties.reduce((a, b) => (b.value > a.value ? b : a));

  return {
    score,
    tier: healthTier(score),
    driver: worst.value > 1 ? worst.key : null,
  };
}

export function healthTier(score: number): HealthTier {
  if (score >= 95) return "operational";
  if (score >= 85) return "degraded";
  if (score >= 60) return "partial";
  return "major";
}

export const HEALTH_TIER_LABEL: Record<HealthTier, string> = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  partial: "Partial outage",
  major: "Major outage",
};

/* -------------------------------------------------------------------------- */
/* Aggregates                                                                  */
/* -------------------------------------------------------------------------- */

export interface MetricSummary {
  readonly current: number;
  readonly previous: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  /** Percent change of the latest value against the mean of the prior half. */
  readonly deltaPct: number;
}

/**
 * Summarises one metric over a window.
 *
 * The delta compares the most recent value against the average of the earlier
 * half of the window rather than against the single preceding sample — a
 * point-to-point delta on noisy telemetry is mostly noise.
 */
export function summarise(points: readonly MetricPoint[], key: MetricKey): MetricSummary {
  if (points.length === 0) {
    return { current: 0, previous: 0, min: 0, max: 0, avg: 0, deltaPct: 0 };
  }

  const values = points.map((point) => point[key]);
  const current = values[values.length - 1] ?? 0;
  const previous = values[values.length - 2] ?? current;

  const half = Math.max(1, Math.floor(values.length / 2));
  const baselineSlice = values.slice(0, half);
  const baseline = baselineSlice.reduce((a, b) => a + b, 0) / baselineSlice.length;

  return {
    current,
    previous,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    deltaPct: baseline === 0 ? 0 : round(((current - baseline) / baseline) * 100, 1),
  };
}

/**
 * Downsamples to at most `maxPoints` by averaging buckets.
 * Keeps the last point exact so the chart's end-label matches the stat tile.
 */
export function downsample(points: readonly MetricPoint[], maxPoints: number): MetricPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return [...points];

  const bucketSize = points.length / maxPoints;
  const out: MetricPoint[] = [];

  for (let i = 0; i < maxPoints; i += 1) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(points.length, Math.floor((i + 1) * bucketSize));
    const bucket = points.slice(start, Math.max(end, start + 1));
    if (bucket.length === 0) continue;

    const mean = (key: MetricKey): number =>
      round(bucket.reduce((sum, point) => sum + point[key], 0) / bucket.length, 2);

    const anchor = bucket[bucket.length - 1];
    if (!anchor) continue;

    out.push({
      t: anchor.t,
      latencyP50: mean("latencyP50"),
      latencyP95: mean("latencyP95"),
      latencyP99: mean("latencyP99"),
      cpu: mean("cpu"),
      errorRate: mean("errorRate"),
      throughput: Math.round(mean("throughput")),
    });
  }

  const last = points[points.length - 1];
  if (last) out[out.length - 1] = last;
  return out;
}
