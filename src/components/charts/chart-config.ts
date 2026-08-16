import { formatCompact, formatLatency, formatPercent } from "@/lib/format";
import type { MetricKey } from "@/types";

/**
 * Chart configuration shared by every plot on the dashboard.
 *
 * Colours are referenced as CSS custom properties, never as hex literals in
 * JSX. SVG resolves `var(--series-1)` at paint time, so switching theme
 * repaints the charts without React re-rendering them and without a second
 * palette living in JavaScript.
 */

export interface SeriesSpec {
  readonly key: MetricKey;
  readonly label: string;
  /** Categorical slot, assigned by entity and never re-assigned on filter. */
  readonly colorVar: `--series-${1 | 2 | 3 | 4}`;
}

/**
 * Fixed slot assignment.
 *
 * The slot belongs to the metric, not to its position in a list: hiding p50
 * must not repaint p95 blue. Slots 1–3 are the only ones used together in one
 * plot — that trio is the set validated for all-pairs CVD separation.
 */
export const SERIES: Record<
  "latencyP50" | "latencyP95" | "latencyP99" | "cpu" | "errorRate" | "throughput",
  SeriesSpec
> = {
  latencyP50: { key: "latencyP50", label: "p50", colorVar: "--series-1" },
  latencyP95: { key: "latencyP95", label: "p95", colorVar: "--series-2" },
  latencyP99: { key: "latencyP99", label: "p99", colorVar: "--series-3" },
  cpu: { key: "cpu", label: "CPU load", colorVar: "--series-1" },
  errorRate: { key: "errorRate", label: "5xx rate", colorVar: "--series-2" },
  throughput: { key: "throughput", label: "Throughput", colorVar: "--series-1" },
};

/** Per-metric value formatting, used by axes, tooltips, tables and tiles alike. */
export const METRIC_FORMATTER: Record<MetricKey, (value: number) => string> = {
  latencyP50: formatLatency,
  latencyP95: formatLatency,
  latencyP99: formatLatency,
  cpu: (value) => formatPercent(value, 0),
  errorRate: (value) => formatPercent(value, 2),
  throughput: (value) => formatCompact(value),
};

/** Axis ticks are terser than tooltip values — the unit is in the axis title. */
export const AXIS_FORMATTER: Record<MetricKey, (value: number) => string> = {
  latencyP50: (value) => `${Math.round(value)}`,
  latencyP95: (value) => `${Math.round(value)}`,
  latencyP99: (value) => `${Math.round(value)}`,
  cpu: (value) => `${Math.round(value)}`,
  errorRate: (value) => (value >= 1 ? value.toFixed(0) : value.toFixed(1)),
  throughput: formatCompact,
};

/** Shared axis chrome. Hairline, solid, one step off the surface. */
export const AXIS_TICK = { fill: "var(--ink-muted)", fontSize: 11 } as const;
export const AXIS_LINE = { stroke: "var(--axis)", strokeWidth: 1 } as const;
export const GRID_STROKE = "var(--grid)";

/** Marker spec: >= 8px diameter with a 2px surface ring so overlaps stay legible. */
export const ACTIVE_DOT = { r: 4, strokeWidth: 2, stroke: "var(--surface)" } as const;
