"use client";

import type { TooltipContentProps } from "recharts";

import type { SeriesSpec } from "@/components/charts/chart-config";
import { formatTimestamp } from "@/lib/format";
import type { MetricKey } from "@/types";

export interface ChartTooltipProps extends Partial<TooltipContentProps> {
  readonly series: readonly SeriesSpec[];
  readonly format: (value: number) => string;
}

/**
 * Crosshair readout.
 *
 * Two rules from the design method are load-bearing here:
 *  - **Every series at that X**, not only the one under the pointer. The reader
 *    aims at a moment in time, never at a 2px line.
 *  - **Values lead, labels follow.** The legend's hierarchy inverted: here the
 *    reader already knows which series they want and came for the number, so the
 *    value is the high-contrast element and the name is secondary.
 *
 * Series identity is a short stroke of the series colour — a line key, matching
 * the mark. The label text itself stays in an ink token; a light categorical hue
 * as text is illegible on the surface.
 */
export function ChartTooltip({ active, payload, label, series, format }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const timestamp = typeof label === "number" ? label : Number(label);

  return (
    <div className="min-w-[172px] rounded-lg border border-hairline bg-surface p-2.5 shadow-[var(--shadow-card)]">
      <p className="tabular mb-1.5 text-[11px] font-medium text-muted">
        {Number.isFinite(timestamp) ? formatTimestamp(timestamp) : String(label ?? "")}
      </p>

      <dl className="flex flex-col gap-1">
        {series.map((spec) => {
          const entry = payload.find((item) => item.dataKey === spec.key);
          if (!entry || typeof entry.value !== "number") return null;

          return (
            <div key={spec.key} className="flex items-baseline justify-between gap-4">
              <dt className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(${spec.colorVar})` }}
                />
                <span className="truncate text-xs text-ink2">{spec.label}</span>
              </dt>
              <dd className="tabular shrink-0 text-xs font-semibold text-ink">
                {format(entry.value)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** Single-metric variant for sparklines and one-series plots. */
export function SimpleTooltip({
  active,
  payload,
  label,
  metricKey,
  format,
}: Partial<TooltipContentProps> & {
  readonly metricKey: MetricKey;
  readonly format: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload.find((item) => item.dataKey === metricKey);
  if (!entry || typeof entry.value !== "number") return null;

  const timestamp = typeof label === "number" ? label : Number(label);

  return (
    <div className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 shadow-[var(--shadow-card)]">
      <p className="tabular text-xs font-semibold text-ink">{format(entry.value)}</p>
      <p className="tabular text-[11px] text-muted">
        {Number.isFinite(timestamp) ? formatTimestamp(timestamp) : String(label ?? "")}
      </p>
    </div>
  );
}
