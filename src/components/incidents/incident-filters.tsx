"use client";

import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/field";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  SEVERITY_LABEL,
  STATUS_LABEL,
} from "@/lib/incidents";
import { SERVICES } from "@/lib/services";
import { cn } from "@/lib/utils";
import { useIncidentStore } from "@/store/incident-store";
import type { IncidentSeverity } from "@/types";

const SEVERITY_CHIP: Record<IncidentSeverity, string> = {
  critical: "data-[on=true]:border-crit data-[on=true]:bg-crit/12",
  major: "data-[on=true]:border-serious data-[on=true]:bg-serious/12",
  warning: "data-[on=true]:border-warn data-[on=true]:bg-warn/12",
};

/**
 * One filter row, above the table it scopes.
 *
 * Severity is a set of toggle chips rather than a multi-select: on a phone,
 * three taps beat opening a listbox, and the current selection is readable
 * without opening anything.
 */
export function IncidentFilters() {
  const filters = useIncidentStore((state) => state.filters);
  const setFilters = useIncidentStore((state) => state.setFilters);
  const reset = useIncidentStore((state) => state.resetFilters);

  const active =
    filters.severities.length > 0 ||
    filters.statuses.length > 0 ||
    filters.serviceIds.length > 0 ||
    filters.query.length > 0 ||
    filters.openOnly;

  const toggleSeverity = (severity: IncidentSeverity): void => {
    const next = filters.severities.includes(severity)
      ? filters.severities.filter((entry) => entry !== severity)
      : [...filters.severities, severity];
    setFilters({ severities: next });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => setFilters({ query: event.target.value })}
            placeholder="Search title, summary or id"
            aria-label="Search incidents"
            className="h-9 w-full rounded-lg border border-hairline bg-plane pl-9 pr-3 text-sm text-ink placeholder:text-muted hover:border-hairline-strong"
          />
        </div>

        <Select
          value={filters.serviceIds[0] ?? ""}
          onChange={(event) =>
            setFilters({ serviceIds: event.target.value === "" ? [] : [event.target.value] })
          }
          aria-label="Filter by service"
          className="sm:w-52"
        >
          <option value="">All services</option>
          {SERVICES.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </Select>

        <Select
          value={filters.statuses[0] ?? ""}
          onChange={(event) =>
            setFilters({
              statuses:
                event.target.value === ""
                  ? []
                  : [event.target.value as (typeof INCIDENT_STATUSES)[number]],
            })
          }
          aria-label="Filter by status"
          className="sm:w-44"
        >
          <option value="">Any status</option>
          {INCIDENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Filter by severity</legend>
          {INCIDENT_SEVERITIES.map((severity) => {
            const on = filters.severities.includes(severity);
            return (
              <button
                key={severity}
                type="button"
                data-on={on}
                aria-pressed={on}
                onClick={() => toggleSeverity(severity)}
                className={cn(
                  "rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-ink2 transition-colors",
                  "hover:border-hairline-strong data-[on=true]:text-ink",
                  SEVERITY_CHIP[severity],
                )}
              >
                {SEVERITY_LABEL[severity]}
              </button>
            );
          })}
        </fieldset>

        <Switch
          checked={filters.openOnly}
          onChange={(checked) => setFilters({ openOnly: checked })}
          label="Open only"
        />

        {active ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={reset}>
            <X aria-hidden="true" className="size-3.5" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
