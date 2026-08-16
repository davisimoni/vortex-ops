"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ACTIVE_DOT,
  AXIS_FORMATTER,
  AXIS_LINE,
  AXIS_TICK,
  GRID_STROKE,
  METRIC_FORMATTER,
  type SeriesSpec,
} from "@/components/charts/chart-config";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { formatClock, formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MetricPoint, TimeRangeSpec } from "@/types";

export interface ThresholdMarker {
  readonly value: number;
  readonly label: string;
}

export interface TimeSeriesChartProps {
  readonly data: readonly MetricPoint[];
  readonly series: readonly SeriesSpec[];
  readonly range: TimeRangeSpec;
  readonly height?: number;
  readonly threshold?: ThresholdMarker;
  /** Holds the previous render at reduced opacity while data reloads. */
  readonly dimmed?: boolean;
  /** Describes the plot for assistive tech, alongside the table view. */
  readonly ariaLabel: string;
}

/**
 * Time-series area chart.
 *
 * Mark specs are fixed: 2px lines with round caps, a ~10% area wash (never a
 * saturated block), hairline solid gridlines one step off the surface, and
 * active dots carrying a 2px surface ring so they stay legible where series
 * cross.
 *
 * There is deliberately no second y-axis. Two measures on different scales get
 * two charts — a dual axis invents a correlation the data does not contain, and
 * it is the single most common way a monitoring chart misleads.
 */
export function TimeSeriesChart({
  data,
  series,
  range,
  height = 220,
  threshold,
  dimmed = false,
  ariaLabel,
}: TimeSeriesChartProps) {
  // Gradient ids must be unique per instance or a second chart on the page
  // silently reuses the first one's fill.
  const gradientPrefix = useId().replace(/:/g, "");
  const formatValue = METRIC_FORMATTER[series[0]?.key ?? "latencyP95"];
  const formatAxis = AXIS_FORMATTER[series[0]?.key ?? "latencyP95"];
  const formatTick = range.tickFormat === "day" ? formatDay : formatClock;

  return (
    <div
      className={cn("transition-opacity duration-200", dimmed && "opacity-55")}
      role="img"
      aria-label={ariaLabel}
    >
      {/* The container includes the x-axis band, so the card never grows a
          nested scrollbar just to reach the tick labels. */}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data as MetricPoint[]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {series.map((spec) => (
              <linearGradient
                key={spec.key}
                id={`${gradientPrefix}-${spec.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={`var(${spec.colorVar})`} stopOpacity={0.14} />
                <stop offset="100%" stopColor={`var(${spec.colorVar})`} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeWidth={1} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => formatTick(value)}
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
            minTickGap={56}
            tickMargin={8}
          />

          <YAxis
            width={44}
            tickCount={5}
            domain={[0, "auto"]}
            tickFormatter={(value: number) => formatAxis(value)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />

          {threshold ? (
            <ReferenceLine
              y={threshold.value}
              stroke="var(--status-critical)"
              strokeWidth={1}
              // Dashed *because* it is a threshold, not data. Gridlines stay solid.
              strokeDasharray="4 3"
              label={{
                value: threshold.label,
                position: "insideTopRight",
                fill: "var(--ink-muted)",
                fontSize: 10,
              }}
            />
          ) : null}

          <Tooltip
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            content={(props) => <ChartTooltip {...props} series={series} format={formatValue} />}
          />

          {series.map((spec) => (
            <Area
              key={spec.key}
              type="monotone"
              dataKey={spec.key}
              stroke={`var(${spec.colorVar})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={`url(#${gradientPrefix}-${spec.key})`}
              dot={false}
              activeDot={{ ...ACTIVE_DOT, fill: `var(${spec.colorVar})` }}
              // Live data arrives every two seconds; animating each arrival
              // turns the plot into a permanent morph.
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
