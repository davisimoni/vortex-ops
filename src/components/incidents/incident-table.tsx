"use client";

import { ChevronRight, UserRound } from "lucide-react";

import { SeverityBadge, StatusBadge } from "@/components/ui/badge";
import { formatDuration, formatRelative, initials } from "@/lib/format";
import { incidentDuration } from "@/lib/incidents";
import { serviceName } from "@/lib/services";
import { cn } from "@/lib/utils";
import { memberName } from "@/store/team-store";
import type { Incident, TeamMember } from "@/types";

export interface IncidentTableProps {
  readonly incidents: readonly Incident[];
  readonly members: readonly TeamMember[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** Single clock for every relative label, so the rows agree with each other. */
  readonly now: number;
}

function Assignee({ name }: { readonly name: string | null }) {
  if (name === null) {
    return <span className="text-xs text-muted">Unassigned</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="flex size-5 items-center justify-center rounded-full bg-brand/15 text-[9px] font-semibold text-ink"
      >
        {initials(name)}
      </span>
      <span className="truncate text-xs text-ink2">{name}</span>
    </span>
  );
}

/**
 * Incident list.
 *
 * Two renderings of the same data: a real `<table>` from `md` up, and stacked
 * cards below it. A six-column table on a 390px screen is either a horizontal
 * scroller or four characters per column, and the phone is where an on-call
 * engineer actually reads this.
 */
export function IncidentTable({
  incidents,
  members,
  selectedId,
  onSelect,
  now,
}: IncidentTableProps) {
  return (
    <>
      {/* Mobile: stacked cards. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {incidents.map((incident) => (
          <li key={incident.id}>
            <button
              type="button"
              onClick={() => onSelect(incident.id)}
              aria-current={incident.id === selectedId ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-2 rounded-xl border border-hairline bg-surface p-3 text-left transition-colors",
                incident.id === selectedId ? "border-brand" : "hover:border-hairline-strong",
              )}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={incident.severity} />
                <StatusBadge status={incident.status} />
                <span className="tabular ml-auto text-[11px] text-muted">{incident.id}</span>
              </span>
              <span className="text-sm font-medium leading-snug text-ink">{incident.title}</span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted">{serviceName(incident.serviceId)}</span>
                <Assignee name={memberName(members, incident.assigneeId)} />
              </span>
              <span className="tabular text-[11px] text-muted">
                {formatDuration(incidentDuration(incident, now))} ·{" "}
                {formatRelative(incident.startedAt, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop: table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <caption className="sr-only">
            Incidents, open first, then by severity and most recent.
          </caption>
          <thead>
            <tr className="border-b border-hairline">
              {["Severity", "Incident", "Service", "Status", "Responder", "Duration", ""].map(
                (heading, index) => (
                  <th
                    key={heading || `spacer-${index}`}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted"
                  >
                    {heading || <span className="sr-only">Open detail</span>}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident) => {
              const selected = incident.id === selectedId;
              return (
                <tr
                  key={incident.id}
                  onClick={() => onSelect(incident.id)}
                  className={cn(
                    "cursor-pointer border-b border-hairline transition-colors last:border-b-0",
                    selected ? "bg-brand/8" : "hover:bg-raised/60",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <SeverityBadge severity={incident.severity} />
                  </td>
                  <td className="max-w-[320px] px-3 py-2.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(incident.id);
                      }}
                      className="text-left"
                    >
                      <span className="block truncate font-medium text-ink">{incident.title}</span>
                      <span className="tabular block text-[11px] text-muted">{incident.id}</span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink2">
                    {serviceName(incident.serviceId)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={incident.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1.5">
                      {incident.assigneeId === null ? (
                        <UserRound aria-hidden="true" className="size-3.5 text-muted" />
                      ) : null}
                      <Assignee name={memberName(members, incident.assigneeId)} />
                    </span>
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2.5 text-xs text-ink2">
                    {formatDuration(incidentDuration(incident, now))}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ChevronRight aria-hidden="true" className="size-4 text-muted" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
