import { describe, expect, it } from "vitest";

import { deriveMaintenanceStatus, maintenanceServiceNames, maintenanceWindowsForStatusPage } from "@/lib/maintenance";
import type { MaintenanceWindow } from "@/types";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

function window(overrides: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
  return {
    id: "mw_1",
    title: "Postgres primary — failover rehearsal",
    description: "",
    serviceIds: ["postgres-primary"],
    startsAt: NOW + DAY,
    endsAt: NOW + DAY + HOUR,
    cancelledAt: null,
    createdAt: NOW - HOUR,
    ...overrides,
  };
}

describe("deriveMaintenanceStatus", () => {
  it("is scheduled before it starts", () => {
    expect(deriveMaintenanceStatus(window({ startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR }), NOW)).toBe(
      "scheduled",
    );
  });

  it("is in_progress between start and end, inclusive of both boundaries", () => {
    const w = window({ startsAt: NOW - HOUR, endsAt: NOW + HOUR });
    expect(deriveMaintenanceStatus(w, NOW)).toBe("in_progress");
    expect(deriveMaintenanceStatus(w, w.startsAt)).toBe("in_progress");
    expect(deriveMaintenanceStatus(w, w.endsAt)).toBe("in_progress");
  });

  it("is completed once past its end", () => {
    expect(deriveMaintenanceStatus(window({ startsAt: NOW - 2 * HOUR, endsAt: NOW - HOUR }), NOW)).toBe(
      "completed",
    );
  });

  it("is cancelled regardless of where now falls relative to the window", () => {
    // Cancelled a scheduled window: still cancelled, not "scheduled".
    expect(
      deriveMaintenanceStatus(window({ startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, cancelledAt: NOW }), NOW),
    ).toBe("cancelled");
    // Cancelled a window whose original span already overlaps now: still
    // cancelled, not "in_progress" — a cancelled maintenance did not happen.
    expect(
      deriveMaintenanceStatus(window({ startsAt: NOW - HOUR, endsAt: NOW + HOUR, cancelledAt: NOW - 30_000 }), NOW),
    ).toBe("cancelled");
  });
});

describe("maintenanceServiceNames", () => {
  it("resolves known service ids to their display name", () => {
    expect(maintenanceServiceNames(window({ serviceIds: ["postgres-primary", "auth-service"] }))).toEqual([
      "Postgres Primary",
      "Auth Service",
    ]);
  });

  it("falls back to the raw id for an unknown service rather than dropping it", () => {
    expect(maintenanceServiceNames(window({ serviceIds: ["some-future-service"] }))).toEqual([
      "some-future-service",
    ]);
  });
});

describe("maintenanceWindowsForStatusPage", () => {
  it("drops cancelled windows entirely, not just marks them", () => {
    const windows = [window({ id: "mw_cancelled", cancelledAt: NOW })];
    expect(maintenanceWindowsForStatusPage(windows, NOW)).toEqual([]);
  });

  it("drops completed windows older than the retention window", () => {
    const old = window({ id: "mw_old", startsAt: NOW - 30 * DAY, endsAt: NOW - 29 * DAY });
    const recent = window({ id: "mw_recent", startsAt: NOW - 2 * DAY, endsAt: NOW - 1 * DAY });
    const result = maintenanceWindowsForStatusPage([old, recent], NOW);
    expect(result.map((entry) => entry.id)).toEqual(["mw_recent"]);
  });

  it("keeps scheduled and in-progress windows, sorted by start time", () => {
    const later = window({ id: "mw_later", startsAt: NOW + 2 * DAY, endsAt: NOW + 2 * DAY + HOUR });
    const sooner = window({ id: "mw_sooner", startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR });
    const result = maintenanceWindowsForStatusPage([later, sooner], NOW);
    expect(result.map((entry) => entry.id)).toEqual(["mw_sooner", "mw_later"]);
  });

  it("resolves service ids to display names and derives status on the public shape", () => {
    const [entry] = maintenanceWindowsForStatusPage(
      [window({ startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, serviceIds: ["api-gateway"] })],
      NOW,
    );
    expect(entry).toMatchObject({ status: "scheduled", serviceNames: ["API Gateway"] });
  });

  it("never carries a cancelledAt-only internal detail — the public shape has no such field", () => {
    const [entry] = maintenanceWindowsForStatusPage([window({ startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR })], NOW);
    expect(entry).not.toHaveProperty("cancelledAt");
    expect(entry).not.toHaveProperty("createdAt");
  });
});
