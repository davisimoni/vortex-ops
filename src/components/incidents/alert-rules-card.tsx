"use client";

import { CheckCircle2, Radio, Timer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { evaluateRules, formatMetricValue, METRIC_LABEL } from "@/lib/alerting";
import { SEVERITY_LABEL } from "@/lib/incidents";
import { serviceName } from "@/lib/services";
import { useIncidentStore } from "@/store/incident-store";
import { useMetricsStore } from "@/store/metrics-store";
import type { IncidentSeverity } from "@/types";

const SEVERITY_TONE: Record<IncidentSeverity, "critical" | "serious" | "warning"> = {
  critical: "critical",
  major: "serious",
  warning: "warning",
};

/**
 * The alerting engine, made visible.
 *
 * Each rule shows its current reading against its threshold and how far into
 * the dwell window it is. A rule engine you cannot observe is indistinguishable
 * from one that is not running — and the first thing anyone asks after a missed
 * page is "was the rule even armed?".
 */
export function AlertRulesCard() {
  const rules = useIncidentStore((state) => state.rules);
  const series = useMetricsStore((state) => state.series);

  const evaluations = evaluateRules(series.slice(-12), rules);

  return (
    <Card>
      <CardHeader
        title="Alert rules"
        subtitle="Evaluated against every incoming sample. A rule must hold past its dwell time before it opens an incident."
        as="h2"
      />
      <CardBody className="flex flex-col gap-2">
        {evaluations.map(({ rule, breached, observed, consecutive }) => {
          const progress = Math.min(consecutive / rule.forSamples, 1);

          return (
            <div
              key={rule.id}
              className="flex flex-col gap-2 rounded-lg border border-hairline p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink">{rule.name}</p>
                  <Badge tone={SEVERITY_TONE[rule.severity]} dot>
                    {SEVERITY_LABEL[rule.severity]}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {serviceName(rule.serviceId)} · {METRIC_LABEL[rule.metric]}{" "}
                  {rule.comparator === "gt" ? ">" : "<"}{" "}
                  {formatMetricValue(rule.metric, rule.threshold)} for {rule.forSamples} samples
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="tabular text-sm font-semibold text-ink">
                    {series.length === 0 ? "—" : formatMetricValue(rule.metric, observed)}
                  </p>
                  <p className="text-[11px] text-muted">current</p>
                </div>

                {breached ? (
                  <Badge tone="critical" icon={Radio}>
                    Firing
                  </Badge>
                ) : consecutive > 0 ? (
                  <Badge tone="warning" icon={Timer}>
                    {consecutive}/{rule.forSamples}
                  </Badge>
                ) : (
                  <Badge tone="good" icon={CheckCircle2}>
                    Armed
                  </Badge>
                )}
              </div>

              {/* Dwell progress. The meter's track is a lighter step of its own
                  fill, so the state reads across the whole bar. */}
              <div
                aria-hidden="true"
                className="h-1 w-full overflow-hidden rounded-full bg-warn/20 sm:hidden"
              >
                <div
                  className="h-full rounded-full bg-warn transition-[width] duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
