import { describe, expect, it } from "vitest";

import {
  aggregateStatus,
  buildUptimeHistory,
  currentServiceStatus,
  recentIncidentsForStatusPage,
  redactIncidentForStatusPage,
  uptimePercent,
} from "@/lib/status-page";
import type { Incident, IncidentEvent, ServiceDefinition } from "@/types";

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 7, 15, 12, 0, 0); // 2026-08-15T12:00:00Z

const SERVICES: readonly ServiceDefinition[] = [
  {
    id: "api-gateway",
    name: "API Gateway",
    tier: "edge",
    owner: "Platform",
    baseline: { latencyMs: 100, cpuPct: 40, errorRatePct: 0.1, throughputRps: 1_000 },
  },
  {
    id: "payments",
    name: "Payments",
    tier: "core",
    owner: "Commerce",
    baseline: { latencyMs: 200, cpuPct: 50, errorRatePct: 0.1, throughputRps: 500 },
  },
];

function timelineEvent(overrides: Partial<IncidentEvent> = {}): IncidentEvent {
  return { id: "evt_1", at: NOW, kind: "opened", message: "Opened.", actor: null, ...overrides };
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "INC-1",
    title: "API Gateway — 5xx spike",
    summary: "Something broke.",
    serviceId: "api-gateway",
    severity: "critical",
    status: "investigating",
    assigneeId: "usr_marco",
    startedAt: NOW,
    resolvedAt: null,
    ruleId: null,
    impactedRequests: 42_000,
    timeline: [timelineEvent()],
    ...overrides,
  };
}

describe("currentServiceStatus / aggregateStatus", () => {
  it("marks every service operational with no incidents", () => {
    const statuses = currentServiceStatus(SERVICES, [], NOW);
    expect(statuses.every((s) => s.tier === "operational")).toBe(true);
    expect(aggregateStatus(statuses)).toBe("operational");
  });

  it("only degrades the specific service an open incident targets", () => {
    const statuses = currentServiceStatus(
      SERVICES,
      [incident({ serviceId: "payments", severity: "critical", status: "investigating" })],
      NOW,
    );

    expect(statuses.find((s) => s.serviceId === "payments")?.tier).toBe("major");
    expect(statuses.find((s) => s.serviceId === "api-gateway")?.tier).toBe("operational");
  });

  it("ignores a resolved incident — it no longer describes current status", () => {
    const statuses = currentServiceStatus(
      SERVICES,
      [incident({ status: "resolved", resolvedAt: NOW - 1_000 })],
      NOW,
    );
    expect(statuses.every((s) => s.tier === "operational")).toBe(true);
  });

  it("ignores an incident that has not started yet", () => {
    const statuses = currentServiceStatus(SERVICES, [incident({ startedAt: NOW + DAY })], NOW);
    expect(statuses.every((s) => s.tier === "operational")).toBe(true);
  });

  it("takes the worst tier across services for the aggregate", () => {
    const statuses = currentServiceStatus(
      SERVICES,
      [
        incident({ serviceId: "api-gateway", severity: "warning" }),
        incident({ id: "INC-2", serviceId: "payments", severity: "critical" }),
      ],
      NOW,
    );
    expect(aggregateStatus(statuses)).toBe("major");
  });
});

describe("buildUptimeHistory", () => {
  it("produces exactly one entry per requested day, oldest first", () => {
    const history = buildUptimeHistory([], 90, NOW);
    expect(history).toHaveLength(90);
    expect(new Date(history[0]!.date).getTime()).toBeLessThan(new Date(history[89]!.date).getTime());
    expect(history.every((day) => day.tier === "operational")).toBe(true);
  });

  it("marks a day major when a critical incident overlapped any part of it", () => {
    const history = buildUptimeHistory(
      [incident({ startedAt: NOW - 2 * DAY, resolvedAt: NOW - 2 * DAY + 3_600_000 })],
      7,
      NOW,
    );
    const impactedDay = history.find((day) => day.date === new Date(NOW - 2 * DAY).toISOString().slice(0, 10));
    expect(impactedDay?.tier).toBe("major");
  });

  it("treats a still-open incident as overlapping every day up to now", () => {
    const history = buildUptimeHistory([incident({ startedAt: NOW - 3 * DAY, resolvedAt: null })], 7, NOW);
    const today = history.at(-1);
    expect(today?.tier).toBe("major");
  });

  it("does not mark a day the incident never reached", () => {
    const history = buildUptimeHistory(
      [incident({ startedAt: NOW - 6 * DAY, resolvedAt: NOW - 6 * DAY + 1_000 })],
      7,
      NOW,
    );
    const today = history.at(-1);
    expect(today?.tier).toBe("operational");
  });
});

describe("uptimePercent", () => {
  it("is 100 for an all-operational history", () => {
    expect(uptimePercent(buildUptimeHistory([], 30, NOW))).toBe(100);
  });

  it("is 100 for an empty history rather than dividing by zero", () => {
    expect(uptimePercent([])).toBe(100);
  });

  it("drops by a full day's weight for one major day out of ten", () => {
    const history = [
      ...buildUptimeHistory([], 9, NOW),
      { date: "2026-08-16", tier: "major" as const },
    ];
    expect(uptimePercent(history)).toBe(90);
  });
});

describe("redactIncidentForStatusPage", () => {
  it("keeps opened, status and note updates but strips assignment and notification events", () => {
    const withFullTimeline = incident({
      timeline: [
        timelineEvent({ kind: "opened", message: "Opened.", actor: null }),
        timelineEvent({ kind: "assignment", message: "Assigned to Marco Bellini.", actor: "Ada Okafor" }),
        timelineEvent({ kind: "notification", message: "Notified #incidents on Slack.", actor: null }),
        timelineEvent({ kind: "note", message: "Root cause found.", actor: "Marco Bellini" }),
        timelineEvent({ kind: "status", message: "Status changed to Identified.", actor: "Marco Bellini" }),
      ],
    });

    const publicIncident = redactIncidentForStatusPage(withFullTimeline);

    expect(publicIncident.updates.map((u) => u.message)).toEqual([
      "Opened.",
      "Root cause found.",
      "Status changed to Identified.",
    ]);
  });

  it("never carries an actor field on the public shape", () => {
    const publicIncident = redactIncidentForStatusPage(incident());
    for (const update of publicIncident.updates) {
      expect(Object.keys(update).sort()).toEqual(["at", "message"]);
    }
  });

  it("drops internal-only fields — assignee id and impacted-request counts", () => {
    const publicIncident = redactIncidentForStatusPage(incident());
    expect(publicIncident).not.toHaveProperty("assigneeId");
    expect(publicIncident).not.toHaveProperty("impactedRequests");
  });
});

describe("recentIncidentsForStatusPage", () => {
  it("excludes incidents that started before the window", () => {
    const incidents = [
      incident({ id: "recent", startedAt: NOW - DAY }),
      incident({ id: "old", startedAt: NOW - 100 * DAY }),
    ];
    const visible = recentIncidentsForStatusPage(incidents, 90, NOW);
    expect(visible.map((i) => i.id)).toEqual(["recent"]);
  });

  it("orders newest first", () => {
    const incidents = [
      incident({ id: "older", startedAt: NOW - 3 * DAY }),
      incident({ id: "newer", startedAt: NOW - 1 * DAY }),
    ];
    const visible = recentIncidentsForStatusPage(incidents, 90, NOW);
    expect(visible.map((i) => i.id)).toEqual(["newer", "older"]);
  });
});
