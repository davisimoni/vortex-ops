"use client";

import { useState } from "react";

import { METRIC_FORMATTER, type SeriesSpec } from "@/components/charts/chart-config";
import { ChartTable } from "@/components/charts/chart-table";
import {
  TimeSeriesChart,
  type ThresholdMarker,
} from "@/components/charts/time-series-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import type { MetricPoint, TimeRangeSpec } from "@/types";

type View = "chart" | "table";

export interface ChartCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly data: readonly MetricPoint[];
  readonly series: readonly SeriesSpec[];
  readonly range: TimeRangeSpec;
  readonly height?: number;
  readonly threshold?: ThresholdMarker;
  readonly dimmed?: boolean;
}

/**
 * Legend + current values.
 *
 * Present whenever there are two or more series — identity must never depend on
 * colour-matching alone. The current value beside each key doubles as the
 * endpoint direct-label, which is the *selective* labelling the method asks for:
 * one number per series, not a number on every point.
 *
 * The label text wears an ink token. Only the 3px key stroke carries the series
 * colour — a light categorical hue used as text is unreadable on the surface.
 */
function Legend({
  series,
  latest,
}: {
  readonly series: readonly SeriesSpec[];
  readonly latest: MetricPoint | undefined;
}) {
  if (series.length < 2) return null;

  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      {series.map((spec) => (
        <li key={spec.key} className="flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-3.5 shrink-0 self-center rounded-full"
            style={{ backgroundColor: `var(${spec.colorVar})` }}
          />
          <span className="text-xs text-muted">{spec.label}</span>
          <span className="text-sm font-semibold text-ink">
            {latest ? METRIC_FORMATTER[spec.key](latest[spec.key]) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Single-series charts get the value as a figure instead of a legend box. */
function SingleValue({
  spec,
  latest,
}: {
  readonly spec: SeriesSpec;
  readonly latest: MetricPoint | undefined;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-0.5 w-3.5 rounded-full"
        style={{ backgroundColor: `var(${spec.colorVar})` }}
      />
      <span className="text-2xl font-semibold leading-none tracking-tight text-ink">
        {latest ? METRIC_FORMATTER[spec.key](latest[spec.key]) : "—"}
      </span>
      <span className="text-xs text-muted">now</span>
    </div>
  );
}

const VIEW_OPTIONS = [
  { value: "chart" as const, label: "Chart" },
  { value: "table" as const, label: "Table" },
];

export function ChartCard({
  title,
  subtitle,
  data,
  series,
  range,
  height = 220,
  threshold,
  dimmed = false,
}: ChartCardProps) {
  const [view, setView] = useState<View>("chart");
  const latest = data[data.length - 1];
  const primary = series[0];

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={title}
        {...(subtitle ? { subtitle } : {})}
        actions={
          <Segmented
            label={`${title} view`}
            options={VIEW_OPTIONS}
            value={view}
            onChange={(next: View) => setView(next)}
          />
        }
      />
      <CardBody className="flex-1">
        {series.length > 1 || !primary ? (
          <Legend series={series} latest={latest} />
        ) : (
          <SingleValue spec={primary} latest={latest} />
        )}

        {view === "chart" ? (
          <TimeSeriesChart
            data={data}
            series={series}
            range={range}
            height={height}
            dimmed={dimmed}
            {...(threshold ? { threshold } : {})}
            ariaLabel={`${title} over the ${range.description.toLowerCase()}. Switch to the table view for exact values.`}
          />
        ) : (
          <ChartTable
            data={data}
            series={series}
            caption={`${title} — ${range.description}, most recent first`}
          />
        )}
      </CardBody>
    </Card>
  );
}
