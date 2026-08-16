"use client";

import { METRIC_LABEL } from "@/lib/alerting";
import { HEALTH_TIER_LABEL } from "@/lib/metrics";
import { clamp } from "@/lib/utils";
import type { HealthAssessment, HealthTier } from "@/types";

const TIER_COLOR: Record<HealthTier, string> = {
  operational: "var(--status-good)",
  degraded: "var(--status-warning)",
  partial: "var(--status-serious)",
  major: "var(--status-critical)",
};

const DRIVER_COPY: Record<string, string> = {
  ...METRIC_LABEL,
  incidents: "Open critical incidents",
};

/** Semicircular meter geometry. */
const RADIUS = 72;
const STROKE = 12;
const CX = 88;
const CY = 88;

function arcPath(): string {
  // 180° sweep, left to right, drawn once and re-used by both strokes.
  return `M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 1 ${CX + RADIUS} ${CY}`;
}

export interface HealthGaugeProps {
  readonly health: HealthAssessment;
  readonly openCritical: number;
}

/**
 * The dashboard's hero figure.
 *
 * One per view, ≥48px, in the same sans as everything else — a display face on
 * a hero number reads as decoration, not as data.
 *
 * The meter's fill carries severity while the unfilled track is a lighter step
 * of that same colour, so the state reads across the whole arc rather than only
 * where the fill happens to end. Tier is stated in words next to it: the four
 * status colours are not distinguishable enough under CVD to carry it alone.
 */
export function HealthGauge({ health, openCritical }: HealthGaugeProps) {
  const arcLength = Math.PI * RADIUS;
  const filled = (clamp(health.score, 0, 100) / 100) * arcLength;
  const color = TIER_COLOR[health.tier];

  return (
    <div className="flex flex-col items-center gap-1 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0">
        <svg
          width={176}
          height={104}
          viewBox="0 0 176 104"
          role="img"
          aria-label={`System health ${health.score} out of 100. ${HEALTH_TIER_LABEL[health.tier]}.`}
        >
          <path
            d={arcPath()}
            fill="none"
            stroke={color}
            strokeOpacity={0.18}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
          <path
            d={arcPath()}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${arcLength}`}
            style={{ transition: "stroke-dasharray 400ms ease-out" }}
          />
        </svg>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="text-5xl font-semibold leading-none tracking-tight text-ink">
            {health.score}
          </span>
          <span className="mt-1 text-xs text-muted">Health score</span>
        </div>
      </div>

      <div className="min-w-0 text-center sm:text-left">
        <p className="text-sm font-semibold text-ink">{HEALTH_TIER_LABEL[health.tier]}</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
          {health.driver === null
            ? "No metric is contributing a meaningful penalty right now."
            : `Largest penalty: ${DRIVER_COPY[health.driver] ?? health.driver}.`}
          {openCritical > 0
            ? ` ${openCritical} open critical incident${openCritical === 1 ? "" : "s"}.`
            : ""}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Weighted from 5xx rate (42), p95 latency (34) and CPU load (24), minus 7 per open critical
          incident.
        </p>
      </div>
    </div>
  );
}
