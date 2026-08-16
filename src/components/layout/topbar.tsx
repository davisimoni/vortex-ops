"use client";

import { Menu, Pause, Play, Radio } from "lucide-react";
import { usePathname } from "next/navigation";

import { matchNavItem } from "@/components/layout/nav-items";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { ClientOnly } from "@/components/ui/client-only";
import { assessHealth, HEALTH_TIER_LABEL } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { useIncidentStore } from "@/store/incident-store";
import { useMetricsStore } from "@/store/metrics-store";
import type { HealthTier, StreamStatus } from "@/types";

const TIER_TONE: Record<HealthTier, "good" | "warning" | "serious" | "critical"> = {
  operational: "good",
  degraded: "warning",
  partial: "serious",
  major: "critical",
};

const STREAM_COPY: Record<StreamStatus, { label: string; className: string }> = {
  connecting: { label: "Connecting", className: "text-muted" },
  live: { label: "Live", className: "text-good" },
  reconnecting: { label: "Reconnecting", className: "text-warn" },
  offline: { label: "Simulated", className: "text-serious" },
  paused: { label: "Paused", className: "text-muted" },
};

/** Global health, derived from the newest sample plus open critical incidents. */
function HealthPill() {
  const point = useMetricsStore((state) => state.series[state.series.length - 1]);
  const openCritical = useIncidentStore(
    (state) =>
      state.incidents.filter(
        (incident) => incident.severity === "critical" && incident.status !== "resolved",
      ).length,
  );

  const health = assessHealth(point, openCritical);

  return (
    <Badge tone={TIER_TONE[health.tier]} dot>
      <span className="hidden sm:inline">{HEALTH_TIER_LABEL[health.tier]}</span>
      <span className="sm:hidden">Health</span>
      <span className="tabular font-semibold">{health.score}%</span>
    </Badge>
  );
}

function StreamIndicator() {
  const status = useMetricsStore((state) => state.status);
  const paused = useMetricsStore((state) => state.paused);
  const togglePaused = useMetricsStore((state) => state.togglePaused);

  const effective: StreamStatus = paused ? "paused" : status;
  const copy = STREAM_COPY[effective];

  return (
    <button
      type="button"
      onClick={togglePaused}
      aria-pressed={paused}
      // The visible text is the connection state, not the action, so the
      // control needs its own name for anyone who cannot infer it from the icon.
      aria-label={paused ? "Resume live updates" : "Pause live updates"}
      title={paused ? "Resume live updates" : "Pause live updates"}
      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-raised px-2 py-1 text-xs font-medium transition-colors hover:border-hairline-strong"
    >
      {paused ? (
        <Play aria-hidden="true" className="size-3 text-muted" />
      ) : (
        <Radio
          aria-hidden="true"
          className={cn("size-3", copy.className, effective === "live" && "animate-pulse-dot")}
        />
      )}
      <span className={cn("hidden sm:inline", copy.className)}>{copy.label}</span>
      {paused ? null : <Pause aria-hidden="true" className="size-3 text-muted sm:hidden" />}
    </button>
  );
}

function pageTitle(pathname: string): string {
  return matchNavItem(pathname)?.label ?? "Vortex Ops";
}

export function Topbar({ onOpenNav }: { readonly onOpenNav: () => void }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-hairline bg-surface/85 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-ink2 transition-colors hover:bg-raised lg:hidden"
      >
        <Menu aria-hidden="true" className="size-4" />
      </button>

      <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight text-ink">
        {pageTitle(pathname)}
      </h1>

      <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
        <OrgSwitcher />

        <span className="hidden h-5 w-px bg-hairline sm:block" />

        <ClientOnly fallback={<span className="h-6 w-20 rounded-md bg-raised" aria-hidden="true" />}>
          <HealthPill />
        </ClientOnly>

        <ClientOnly fallback={<span className="h-6 w-16 rounded-lg bg-raised" aria-hidden="true" />}>
          <StreamIndicator />
        </ClientOnly>

        <span className="hidden h-5 w-px bg-hairline sm:block" />

        <ThemeToggle />

        <UserMenu />
      </div>
    </header>
  );
}
