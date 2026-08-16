"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { useId } from "react";

import type { MetricPoint } from "@/types";

export interface SparklineProps {
  readonly data: readonly MetricPoint[];
  readonly metricKey: keyof Omit<MetricPoint, "t">;
  readonly colorVar: string;
  readonly height?: number;
}

/**
 * Twelve-point trend line for a stat tile.
 *
 * No axes, no tooltip, no legend: the tile's own value and delta carry the
 * numbers, and this only has to answer "which way has it been going". Adding a
 * hover layer to a 28px-tall mark would be a pinpoint target nobody can hit.
 */
export function Sparkline({ data, metricKey, colorVar, height = 34 }: SparklineProps) {
  const gradientId = `spark-${useId().replace(/:/g, "")}`;
  const points = data.slice(-24);

  if (points.length < 2) return <div style={{ height }} aria-hidden="true" />;

  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={points as MetricPoint[]} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(${colorVar})`} stopOpacity={0.18} />
              <stop offset="100%" stopColor={`var(${colorVar})`} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Padded domain keeps a flat series off the floor of its own box. */}
          <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
          <Area
            type="monotone"
            dataKey={metricKey}
            stroke={`var(${colorVar})`}
            strokeWidth={1.75}
            strokeLinecap="round"
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
