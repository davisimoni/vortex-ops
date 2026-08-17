import { getService } from "@/lib/services";
import type { MaintenanceStatus, MaintenanceWindow } from "@/types";

/**
 * Pure logic for maintenance windows — no database access, mirroring
 * `lib/status-page.ts`. `deriveMaintenanceStatus` in particular has to be
 * usable identically from the incidents page and from the public status page,
 * so a scheduled window reads the same "Scheduled" everywhere rather than
 * each caller reimplementing the same three comparisons slightly differently.
 */

export const MAINTENANCE_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * `scheduled` / `in_progress` / `completed` are always derived from the clock
 * against `startsAt`/`endsAt`, never stored — see the schema comment on
 * `MaintenanceWindow`. `cancelled` overrides all three: a cancelled window
 * that technically overlaps "now" is not in progress, it did not happen.
 */
export function deriveMaintenanceStatus(
  window: Pick<MaintenanceWindow, "startsAt" | "endsAt" | "cancelledAt">,
  now: number = Date.now(),
): MaintenanceStatus {
  if (window.cancelledAt !== null) return "cancelled";
  if (now < window.startsAt) return "scheduled";
  if (now <= window.endsAt) return "in_progress";
  return "completed";
}

/** Display names for a window's affected services, falling back to the raw id for an unknown one. */
export function maintenanceServiceNames(window: Pick<MaintenanceWindow, "serviceIds">): string[] {
  return window.serviceIds.map((id) => getService(id)?.name ?? id);
}

/* -------------------------------------------------------------------------- */
/* Public status page projection                                              */
/* -------------------------------------------------------------------------- */

export interface PublicMaintenanceWindow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly serviceNames: readonly string[];
  readonly startsAt: number;
  readonly endsAt: number;
  readonly status: MaintenanceStatus;
}

/**
 * Windows a stranger on the public status page may see, newest-starting first.
 *
 * Cancelled windows are dropped entirely rather than shown crossed out — a
 * maintenance that never happened is not a fact about the service's history,
 * and showing it invites the same "why was this cancelled" question a real
 * status page has no mechanism to answer. Completed windows age out after a
 * week: a maintenance from two months ago is not "scheduled maintenance" any
 * more, it is old news nobody visiting today needs on the page.
 */
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function maintenanceWindowsForStatusPage(
  windows: readonly MaintenanceWindow[],
  now: number = Date.now(),
): PublicMaintenanceWindow[] {
  return windows
    .map((window) => ({ window, status: deriveMaintenanceStatus(window, now) }))
    .filter(({ status, window }) => {
      if (status === "cancelled") return false;
      if (status === "completed") return now - window.endsAt <= COMPLETED_RETENTION_MS;
      return true;
    })
    .sort((a, b) => a.window.startsAt - b.window.startsAt)
    .map(({ window, status }) => ({
      id: window.id,
      title: window.title,
      description: window.description,
      serviceNames: maintenanceServiceNames(window),
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      status,
    }));
}
