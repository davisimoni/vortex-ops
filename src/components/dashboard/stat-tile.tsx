"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { METRIC_FORMATTER, type SeriesSpec } from "@/components/charts/chart-config";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { summarise } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { MetricPoint } from "@/types";

export interface StatTileProps {
  readonly label: string;
  readonly spec: SeriesSpec;
  readonly data: readonly MetricPoint[];
  /**
   * Whether an increase is a good thing. Latency rising is bad; throughput
   * rising is good — colouring both green would make the tile decorative.
   */
  readonly upIsGood: boolean;
  readonly comparisonLabel?: string;
}

/**
 * Stat tile: label · value · delta · trend.
 *
 * The value uses the font's proportional figures, not `tabular-nums` — equal
 * width digits make a large standalone number look loose. Tabular is reserved
 * for columns that align vertically.
 */
export function StatTile({
  label,
  spec,
  data,
  upIsGood,
  comparisonLabel = "vs earlier in window",
}: StatTileProps) {
  const summary = summarise(data, spec.key);
  const format = METRIC_FORMATTER[spec.key];

  const flat = Math.abs(summary.deltaPct) < 0.5;
  const rising = summary.deltaPct > 0;
  const good = flat ? null : rising === upIsGood;

  const DeltaIcon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;
  const deltaClass = flat
    ? "text-muted"
    : good
      ? "text-[var(--delta-up)]"
      : "text-[var(--delta-down)]";

  return (
    // A labelled group, so the value, delta and trend are announced as one unit
    // rather than as three loose fragments in the page's reading order.
    <Card role="group" aria-label={label} className="flex flex-col gap-2 p-4">
      <p className="text-xs font-medium text-ink2">{label}</p>

      <p className="text-2xl font-semibold leading-none tracking-tight text-ink">
        {data.length === 0 ? "—" : format(summary.current)}
      </p>

      <div className="flex items-center gap-1.5">
        <DeltaIcon aria-hidden="true" className={cn("size-3.5 shrink-0", deltaClass)} />
        <span className={cn("text-xs font-medium", deltaClass)}>
          {flat ? "Steady" : `${rising ? "+" : ""}${formatNumber(summary.deltaPct, 1)}%`}
        </span>
        <span className="truncate text-xs text-muted">{comparisonLabel}</span>
      </div>

      <Sparkline data={data} metricKey={spec.key} colorVar={spec.colorVar} />
    </Card>
  );
}
