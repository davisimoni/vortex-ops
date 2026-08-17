"use client";

import { Network } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { ChartCard } from "@/components/charts/chart-card";
import { SERIES } from "@/components/charts/chart-config";
import { ChaosButton } from "@/components/dashboard/chaos-button";
import { DemoTour } from "@/components/dashboard/demo-tour";
import { HealthGauge } from "@/components/dashboard/health-gauge";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Card, CardBody } from "@/components/ui/card";
import { ChartSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { formatDuration } from "@/lib/format";
import { assessHealth, getRange, TIME_RANGES } from "@/lib/metrics";
import { summariseIncidents } from "@/lib/incidents";
import { SERVICES } from "@/lib/services";
import { useIncidentStore } from "@/store/incident-store";
import { useMetricsStore } from "@/store/metrics-store";
import type { TimeRangeId } from "@/types";

const RANGE_OPTIONS = TIME_RANGES.map((range) => ({
  value: range.id,
  label: range.label,
  description: range.description,
}));

const LATENCY_SERIES = [SERIES.latencyP50, SERIES.latencyP95, SERIES.latencyP99] as const;

function LoadingDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody>
          <Skeleton className="h-24 w-full" />
        </CardBody>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index} className="p-4">
            <Skeleton className="h-20 w-full" />
          </Card>
        ))}
      </div>
      <Card>
        <CardBody>
          <ChartSkeleton height={260} />
        </CardBody>
      </Card>
    </div>
  );
}

export function DashboardView() {
  const range = useMetricsStore((state) => state.range);
  const setRange = useMetricsStore((state) => state.setRange);
  const series = useMetricsStore((state) => state.series);
  const ready = useMetricsStore((state) => state.ready);
  const incidents = useIncidentStore((state) => state.incidents);

  const [pending, startTransition] = useTransition();

  if (!ready) return <LoadingDashboard />;

  const spec = getRange(range);
  const latest = series[series.length - 1];
  const stats = summariseIncidents(incidents);
  const health = assessHealth(latest, stats.critical);

  return (
    <div className="flex flex-col gap-4">
      {/*
        One filter row, above everything it scopes. Changing the range
        re-renders every card below against the same slice, so no two numbers on
        the page can disagree about which window they describe.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Time range"
          options={RANGE_OPTIONS}
          value={range}
          onChange={(next: TimeRangeId) => startTransition(() => setRange(next))}
        />
        <p className="text-xs text-muted">
          {spec.description} · {spec.points} points ·{" "}
          {formatDuration(spec.stepMs)} resolution
        </p>

        <div className="ml-auto flex items-center gap-2">
          <DemoTour />
          <div id="chaos-trigger">
            <ChaosButton />
          </div>
        </div>
      </div>

      {/* Hero: exactly one oversized figure per view. */}
      <Card>
        <CardBody className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <HealthGauge health={health} openCritical={stats.critical} />

          <dl className="grid grid-cols-3 gap-4 border-t border-hairline pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div>
              <dt className="text-xs text-muted">Open incidents</dt>
              <dd className="mt-1 text-xl font-semibold text-ink">{stats.open}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Unassigned</dt>
              <dd className="mt-1 text-xl font-semibold text-ink">{stats.unassigned}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">MTTR</dt>
              <dd className="mt-1 text-xl font-semibold text-ink">
                {stats.mttrMs === null ? "—" : formatDuration(stats.mttrMs)}
              </dd>
            </div>
            <div className="col-span-3">
              <dt className="text-xs text-muted">Services monitored</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink2">
                {SERVICES.length} across {new Set(SERVICES.map((s) => s.tier)).size} tiers
                <Link
                  href="/dashboard/topology"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  <Network aria-hidden="true" className="size-3" />
                  View topology
                </Link>
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Latency p95" spec={SERIES.latencyP95} data={series} upIsGood={false} />
        <StatTile label="CPU load" spec={SERIES.cpu} data={series} upIsGood={false} />
        <StatTile label="5xx error rate" spec={SERIES.errorRate} data={series} upIsGood={false} />
        <StatTile label="Throughput" spec={SERIES.throughput} data={series} upIsGood />
      </div>

      <ChartCard
        title="API latency"
        subtitle="Percentiles across the public gateway. The tail is what pages people, not the mean."
        data={series}
        series={LATENCY_SERIES}
        range={spec}
        height={260}
        dimmed={pending}
      />

      {/*
        Two plots, one scale each. CPU (%) and throughput (rps) never share an
        axis — a dual-axis chart invents a correlation the data does not have.
      */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="5xx error rate"
          subtitle="Share of responses returning a server error."
          data={series}
          series={[SERIES.errorRate]}
          range={spec}
          threshold={{ value: 2, label: "Alert threshold 2%" }}
          dimmed={pending}
        />
        <ChartCard
          title="CPU load"
          subtitle="Fleet-wide utilisation. A leading indicator, not a symptom users feel."
          data={series}
          series={[SERIES.cpu]}
          range={spec}
          threshold={{ value: 85, label: "Alert threshold 85%" }}
          dimmed={pending}
        />
      </div>

      <ChartCard
        title="Throughput"
        subtitle="Requests per second reaching the gateway."
        data={series}
        series={[SERIES.throughput]}
        range={spec}
        height={200}
        dimmed={pending}
      />
    </div>
  );
}
