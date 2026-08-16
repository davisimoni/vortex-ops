import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/csv";
import {
  AUDIT_COLUMNS,
  buildSlaReport,
  INCIDENT_COLUMNS,
  RESOLUTION_TARGET_MS,
  SLA_COLUMNS,
} from "@/server/compliance/report";
import type { AuditEvent } from "@/server/repository/types";
import type { Incident } from "@/types";

const HOUR = 60 * 60_000;
const ORG = { id: "org_acme", name: "Acme Corp", slug: "acme-corp" };

/**
 * `status` and `resolvedAt` are two separate fields on a real incident, and
 * `isOpen()` reads only `status` — so a fixture with `resolvedAt` set but
 * `status: "investigating"` would silently miscount as "open" everywhere the
 * report uses `isOpen`. The default keeps them consistent; call sites that
 * pass `resolvedAt` explicitly pass a matching `status` too.
 */
function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "INC-0001",
    title: "Test incident",
    summary: "Something broke.",
    serviceId: "api-gateway",
    severity: "major",
    status: "investigating",
    assigneeId: null,
    startedAt: 0,
    resolvedAt: null,
    ruleId: null,
    impactedRequests: 0,
    timeline: [],
    ...overrides,
  };
}

describe("buildSlaReport", () => {
  it("computes MTTR only over resolved incidents", () => {
    const report = buildSlaReport(ORG, [
      incident({ id: "INC-1", startedAt: 0, resolvedAt: HOUR, status: "resolved" }),
      incident({ id: "INC-2", startedAt: 0, resolvedAt: 3 * HOUR, status: "resolved" }),
      incident({ id: "INC-3", startedAt: 0, resolvedAt: null }),
    ]);

    // (1h + 3h) / 2 = 2h, over the two resolved incidents only.
    expect(report.totals.mttrMs).toBe(2 * HOUR);
    expect(report.totals.resolved).toBe(2);
    expect(report.totals.open).toBe(1);
  });

  it("returns null MTTR when nothing is resolved", () => {
    const report = buildSlaReport(ORG, [incident({ resolvedAt: null })]);
    expect(report.totals.mttrMs).toBeNull();
  });

  it("computes MTTA from the first assignment event on the timeline", () => {
    const report = buildSlaReport(ORG, [
      incident({
        id: "INC-1",
        startedAt: 0,
        resolvedAt: HOUR,
        status: "resolved",
        timeline: [
          { id: "e1", at: 0, kind: "opened", message: "opened", actor: null },
          { id: "e2", at: 10 * 60_000, kind: "assignment", message: "assigned", actor: "Ada" },
        ],
      }),
    ]);

    expect(report.totals.mttaMs).toBe(10 * 60_000);
  });

  it("ignores incidents with no assignment event when computing MTTA", () => {
    const report = buildSlaReport(ORG, [incident({ timeline: [] })]);
    expect(report.totals.mttaMs).toBeNull();
  });

  it("computes attainment against the per-severity resolution target", () => {
    // Critical target is 1h.
    const withinTarget = incident({
      id: "INC-1",
      severity: "critical",
      startedAt: 0,
      resolvedAt: RESOLUTION_TARGET_MS.critical - 1,
      status: "resolved",
    });
    const missedTarget = incident({
      id: "INC-2",
      severity: "critical",
      startedAt: 0,
      resolvedAt: RESOLUTION_TARGET_MS.critical + 60_000,
      status: "resolved",
    });

    const report = buildSlaReport(ORG, [withinTarget, missedTarget]);
    expect(report.totals.attainmentPct).toBe(50);
  });

  it("breaks totals down per service", () => {
    const report = buildSlaReport(ORG, [
      incident({ id: "INC-1", serviceId: "api-gateway", resolvedAt: HOUR, status: "resolved" }),
      incident({ id: "INC-2", serviceId: "api-gateway", resolvedAt: 2 * HOUR, status: "resolved" }),
      incident({ id: "INC-3", serviceId: "payments", resolvedAt: null }),
    ]);

    const gateway = report.byService.find((row) => row.serviceId === "api-gateway");
    const payments = report.byService.find((row) => row.serviceId === "payments");

    expect(gateway?.total).toBe(2);
    expect(gateway?.mttrMs).toBe(1.5 * HOUR);
    expect(payments?.total).toBe(1);
    expect(payments?.open).toBe(1);
  });

  it("breaks totals down per severity, each against its own target", () => {
    const report = buildSlaReport(ORG, [
      incident({ id: "INC-1", severity: "critical", resolvedAt: HOUR, status: "resolved" }),
      incident({ id: "INC-2", severity: "warning", resolvedAt: HOUR, status: "resolved" }),
    ]);

    const critical = report.bySeverity.find((row) => row.severity === "critical");
    const warning = report.bySeverity.find((row) => row.severity === "warning");

    expect(critical?.targetMs).toBe(RESOLUTION_TARGET_MS.critical);
    expect(warning?.targetMs).toBe(RESOLUTION_TARGET_MS.warning);
    // 1h against a 24h warning target — comfortably inside.
    expect(warning?.attainmentPct).toBe(100);
  });

  it("scopes to the requested window by start time", () => {
    const report = buildSlaReport(
      ORG,
      [incident({ id: "INC-1", startedAt: 0 }), incident({ id: "INC-2", startedAt: 10 * HOUR })],
      { from: 5 * HOUR, to: 20 * HOUR },
    );

    expect(report.totals.incidents).toBe(1);
  });

  it("sums impacted requests across the window", () => {
    const report = buildSlaReport(ORG, [
      incident({ id: "INC-1", impactedRequests: 100 }),
      incident({ id: "INC-2", impactedRequests: 250 }),
    ]);
    expect(report.totals.impactedRequests).toBe(350);
  });

  it("carries the organisation identity through unchanged", () => {
    const report = buildSlaReport(ORG, []);
    expect(report.organization).toEqual(ORG);
  });
});

describe("CSV column definitions", () => {
  it("renders an incident row with a human-readable duration and target flag", () => {
    const csv = toCsv(
      [
        incident({
          id: "INC-42",
          severity: "warning",
          startedAt: 0,
          resolvedAt: HOUR,
          status: "resolved",
        }),
      ],
      INCIDENT_COLUMNS,
    );
    expect(csv).toContain("INC-42");
    expect(csv).toContain("yes"); // 1h resolution comfortably beats the 24h warning target
  });

  it("flags an incident that missed its resolution target", () => {
    const csv = toCsv(
      [
        incident({
          id: "INC-43",
          severity: "critical",
          startedAt: 0,
          resolvedAt: RESOLUTION_TARGET_MS.critical + HOUR,
          status: "resolved",
        }),
      ],
      INCIDENT_COLUMNS,
    );
    expect(csv).toContain("no");
  });

  it("renders an audit row, including denials", () => {
    const event: AuditEvent = {
      id: "aud_1",
      at: 0,
      orgId: "org_acme",
      actorId: "usr_lena",
      actorName: "Lena Vogt",
      action: "incident.transition",
      targetType: "incident",
      targetId: "INC-1",
      outcome: "denied",
      metadata: { reason: "illegal transition" },
      ip: "203.0.113.5",
    };

    const csv = toCsv([event], AUDIT_COLUMNS);
    expect(csv).toContain("Lena Vogt");
    expect(csv).toContain("denied");
    expect(csv).toContain("203.0.113.5");
  });

  it("renders the SLA summary columns", () => {
    const report = buildSlaReport(ORG, [
      incident({ id: "INC-1", serviceId: "api-gateway", resolvedAt: HOUR, status: "resolved" }),
    ]);
    const csv = toCsv(report.byService, SLA_COLUMNS);
    expect(csv).toContain("API Gateway");
  });
});
