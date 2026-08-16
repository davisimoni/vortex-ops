"use client";

import { create } from "zustand";

import { generateSeries, getRange } from "@/lib/metrics";
import type { MetricPoint, StreamStatus, TimeRangeId } from "@/types";

/**
 * Live metric state.
 *
 * Deliberately free of browser APIs: the store holds data and transitions, the
 * `useMetricStream` hook owns the EventSource. That split keeps the reducer
 * logic unit-testable and means a transport swap (SSE → WebSocket) touches one
 * file.
 *
 * Series are generated lazily, on the client, after mount. Generating them
 * during render would produce different values on the server and in the
 * browser — a guaranteed hydration mismatch, since the seed includes "now".
 */

interface MetricsState {
  readonly range: TimeRangeId;
  readonly series: readonly MetricPoint[];
  readonly status: StreamStatus;
  /** `false` until the first client-side generation lands. */
  readonly ready: boolean;
  /** Timestamp of the most recent sample applied. */
  readonly lastSampleAt: number | null;
  /** Live updates suspended by the viewer. Kept separate from `status`. */
  readonly paused: boolean;
  /**
   * Per-organisation generator seed.
   *
   * Telemetry is isolated the same way every other resource is: switching
   * tenant regenerates the series from that tenant's seed, so Acme and Stark do
   * not show the same charts with a different name on top.
   */
  readonly seed: number;
  /**
   * An active chaos-engineering drill, or `null`.
   *
   * The server-sent stream has its own generator state the client does not
   * control (see `use-metric-stream.ts`), so injecting a fabricated point
   * directly would be overwritten by the next real tick within seconds. This
   * instead multiplies every *real* incoming sample by a decaying factor for
   * the drill's duration — the spike rides on top of live data rather than
   * replacing it, and fades back to baseline on its own.
   */
  readonly chaosSpike: { readonly startedAt: number; readonly durationMs: number } | null;

  initialise: (seed: number, now?: number) => void;
  setRange: (range: TimeRangeId) => void;
  setStatus: (status: StreamStatus) => void;
  applySample: (point: MetricPoint) => void;
  togglePaused: () => void;
  /** Starts a chaos drill: incoming samples are inflated, decaying back to normal. */
  triggerChaosSpike: (durationMs?: number) => void;
}

const DEFAULT_CHAOS_DURATION_MS = 45_000;

/**
 * Multiplier for the spike, 1 at the moment it starts and decaying linearly to
 * 1 once `durationMs` has elapsed. `null` once expired, so the caller can clear
 * the flag instead of multiplying by 1 forever.
 */
export function chaosMultiplier(
  spike: { readonly startedAt: number; readonly durationMs: number } | null,
  now: number,
): number | null {
  if (!spike) return null;
  const elapsed = now - spike.startedAt;
  if (elapsed >= spike.durationMs) return null;
  const remaining = 1 - elapsed / spike.durationMs;
  // Peaks around 4x error rate / CPU and roughly doubled tail latency, then
  // relaxes back to 1 — dramatic enough to read as an outage on the charts
  // without pinning every metric at its clamp ceiling for the whole drill.
  return 1 + remaining * 3;
}

/** Applies the chaos multiplier to the metrics a viewer actually reads as "an outage". */
export function applyChaosMultiplier(point: MetricPoint, factor: number): MetricPoint {
  return {
    ...point,
    errorRate: Math.min(100, point.errorRate * factor),
    latencyP95: point.latencyP95 * factor,
    latencyP99: point.latencyP99 * factor,
    cpu: Math.min(100, point.cpu * (1 + (factor - 1) * 0.5)),
  };
}

/**
 * Folds a fresh sample into the series.
 *
 * On the 1-hour view each sample is its own point, so the window scrolls. On
 * wider ranges one live sample is a fraction of a bucket — appending it would
 * silently change the x-axis resolution, so it updates the trailing bucket
 * instead and the axis stays honest.
 */
export function applySampleToSeries(
  series: readonly MetricPoint[],
  point: MetricPoint,
  range: TimeRangeId,
): MetricPoint[] {
  const spec = getRange(range);
  if (series.length === 0) return [point];

  if (range === "1h") {
    const next = [...series, point];
    return next.length > spec.points ? next.slice(next.length - spec.points) : next;
  }

  const head = series.slice(0, -1);
  const tail = series[series.length - 1];
  if (!tail) return [point];
  // Keep the bucket's own timestamp so ticks stay on the grid.
  return [...head, { ...point, t: tail.t }];
}

export const useMetricsStore = create<MetricsState>()((set, get) => ({
  range: "24h",
  series: [],
  status: "connecting",
  ready: false,
  lastSampleAt: null,
  paused: false,
  seed: 1_337,
  chaosSpike: null,

  initialise: (seed, now = Date.now()) => {
    const { range, seed: current, ready } = get();
    // Re-initialising with the same seed would throw away live samples already
    // collected; only a tenant switch should reset the history.
    if (ready && current === seed) return;

    set({
      seed,
      series: generateSeries(range, { seed, endAt: now }),
      ready: true,
      lastSampleAt: now,
    });
  },

  setRange: (range) => {
    // Regenerating from the same seed keeps the shape of history consistent
    // across range switches — zooming out must not rewrite the past.
    set({
      range,
      series: generateSeries(range, { seed: get().seed, endAt: Date.now() }),
      ready: true,
    });
  },

  setStatus: (status) => set({ status }),

  applySample: (point) => {
    const { paused, series, range, chaosSpike } = get();
    if (paused) return;

    const factor = chaosMultiplier(chaosSpike, point.t);
    const effective = factor === null ? point : applyChaosMultiplier(point, factor);

    set({
      series: applySampleToSeries(series, effective, range),
      lastSampleAt: point.t,
      // Drop the drill once it has decayed back to baseline, rather than
      // recomputing an expired multiplier on every future sample.
      ...(chaosSpike && factor === null ? { chaosSpike: null } : {}),
    });
  },

  togglePaused: () => set((state) => ({ paused: !state.paused })),

  triggerChaosSpike: (durationMs = DEFAULT_CHAOS_DURATION_MS) => {
    set({ chaosSpike: { startedAt: Date.now(), durationMs } });
  },
}));

/** Latest sample, or `undefined` before the first generation. */
export function useLatestPoint(): MetricPoint | undefined {
  return useMetricsStore((state) => state.series[state.series.length - 1]);
}
