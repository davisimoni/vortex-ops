"use client";

import type { SeriesSpec } from "@/components/charts/chart-config";
import { METRIC_FORMATTER } from "@/components/charts/chart-config";
import { formatTimestamp } from "@/lib/format";
import type { MetricPoint } from "@/types";

export interface ChartTableProps {
  readonly data: readonly MetricPoint[];
  readonly series: readonly SeriesSpec[];
  readonly caption: string;
  /** Newest rows first, capped so the panel stays scannable. */
  readonly maxRows?: number;
}

/**
 * The table twin of a chart.
 *
 * Every chart on this dashboard has one. It is the WCAG-clean path to the same
 * numbers: no colour, no hover, no pointer precision required. It also covers
 * the relief rule for the light-mode aqua series, whose 2.74:1 contrast against
 * the light surface is below the 3:1 threshold — the value is always reachable
 * as text, so the hue never carries meaning alone.
 */
export function ChartTable({ data, series, caption, maxRows = 40 }: ChartTableProps) {
  const rows = [...data].slice(-maxRows).reverse();

  return (
    <div className="max-h-[280px] overflow-auto rounded-lg border border-hairline">
      <table className="w-full min-w-[380px] border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-raised">
          <tr>
            <th scope="col" className="border-b border-hairline px-3 py-2 font-medium text-ink2">
              Time
            </th>
            {series.map((spec) => (
              <th
                key={spec.key}
                scope="col"
                className="border-b border-hairline px-3 py-2 text-right font-medium text-ink2"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: `var(${spec.colorVar})` }}
                  />
                  {spec.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr key={point.t} className="even:bg-raised/40">
              <th
                scope="row"
                className="tabular whitespace-nowrap px-3 py-1.5 font-normal text-muted"
              >
                {formatTimestamp(point.t)}
              </th>
              {series.map((spec) => (
                <td key={spec.key} className="tabular px-3 py-1.5 text-right text-ink">
                  {METRIC_FORMATTER[spec.key](point[spec.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
