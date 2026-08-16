import { beforeAll, describe, expect, it } from "vitest";

import { buildSeed } from "@/server/seed/fixtures";
import {
  allowedTransitions,
  canTransition,
  EMPTY_FILTERS,
  filterIncidents,
  incidentDuration,
  INCIDENT_STATUSES,
  isOpen,
  meetsMinimumSeverity,
  sortIncidents,
  statusIndex,
  summariseIncidents,
} from "@/lib/incidents";
import type { Incident } from "@/types";

const NOW = 1_700_000_000_000;

// `buildSeed` hashes the demo password once (scrypt, ~100ms) and produces
// fixtures for both tenants; resolved once and filtered per test rather than
// re-run for every case.
let acmeIncidents: Incident[];

beforeAll(async () => {
  const seed = await buildSeed(NOW);
  acmeIncidents = seed.incidents.filter((incident) => incident.orgId === "org_acme");
});

function incidents(): Incident[] {
  return acmeIncidents;
}

describe("transition table", () => {
  it("forbids skipping straight from investigating to resolved", () => {
    // An incident with no Identified step produces a post-mortem nobody can
    // reconstruct, which is the whole reason status is tracked.
    expect(canTransition("investigating", "resolved")).toBe(false);
  });

  it("allows the forward path one step at a time", () => {
    expect(canTransition("investigating", "identified")).toBe(true);
    expect(canTransition("identified", "monitoring")).toBe(true);
    expect(canTransition("monitoring", "resolved")).toBe(true);
  });

  it("allows a single step backwards, because fixes do not always hold", () => {
    expect(canTransition("monitoring", "identified")).toBe(true);
    expect(canTransition("identified", "investigating")).toBe(true);
  });

  it("allows reopening a resolved incident", () => {
    expect(canTransition("resolved", "investigating")).toBe(true);
    expect(canTransition("resolved", "monitoring")).toBe(false);
  });

  it("never offers a transition to the same status", () => {
    for (const status of INCIDENT_STATUSES) {
      expect(allowedTransitions(status)).not.toContain(status);
    }
  });

  it("orders statuses for the stepper", () => {
    expect(statusIndex("investigating")).toBe(0);
    expect(statusIndex("resolved")).toBe(3);
  });
});

describe("severity thresholds", () => {
  it("delivers a critical incident to a warning-and-above route", () => {
    expect(meetsMinimumSeverity("critical", "warning")).toBe(true);
  });

  it("withholds a warning from a critical-only route", () => {
    expect(meetsMinimumSeverity("warning", "critical")).toBe(false);
  });

  it("includes the boundary itself", () => {
    expect(meetsMinimumSeverity("major", "major")).toBe(true);
  });
});

describe("filterIncidents", () => {
  it("treats an empty facet as no constraint, not as match-nothing", () => {
    // The alternative shows an empty table on first paint, which every reader
    // interprets as a broken page.
    const all = incidents();
    expect(filterIncidents(all, EMPTY_FILTERS)).toHaveLength(all.length);
  });

  it("filters by severity", () => {
    const result = filterIncidents(incidents(), { ...EMPTY_FILTERS, severities: ["critical"] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((incident) => incident.severity === "critical")).toBe(true);
  });

  it("filters by service", () => {
    const result = filterIncidents(incidents(), {
      ...EMPTY_FILTERS,
      serviceIds: ["api-gateway"],
    });
    expect(result.every((incident) => incident.serviceId === "api-gateway")).toBe(true);
  });

  it("hides resolved incidents when openOnly is set", () => {
    const result = filterIncidents(incidents(), { ...EMPTY_FILTERS, openOnly: true });
    expect(result.every(isOpen)).toBe(true);
  });

  it("searches title, summary and id case-insensitively", () => {
    const byId = filterIncidents(incidents(), { ...EMPTY_FILTERS, query: "inc-2411" });
    expect(byId).toHaveLength(1);
    expect(byId[0]?.id).toBe("INC-2411");

    const bySummary = filterIncidents(incidents(), { ...EMPTY_FILTERS, query: "REPLICA" });
    expect(bySummary.length).toBeGreaterThan(0);
  });

  it("combines facets with AND", () => {
    const result = filterIncidents(incidents(), {
      ...EMPTY_FILTERS,
      severities: ["critical"],
      serviceIds: ["search-index"],
    });
    expect(result).toHaveLength(0);
  });
});

describe("sortIncidents", () => {
  it("puts open incidents before resolved ones, then most severe first", () => {
    const sorted = sortIncidents(incidents());
    const openCount = sorted.filter(isOpen).length;

    sorted.slice(0, openCount).forEach((incident) => expect(isOpen(incident)).toBe(true));
    sorted.slice(openCount).forEach((incident) => expect(isOpen(incident)).toBe(false));

    expect(sorted[0]?.severity).toBe("critical");
  });

  it("does not mutate its input", () => {
    const original = incidents();
    const snapshot = original.map((incident) => incident.id);
    sortIncidents(original);
    expect(original.map((incident) => incident.id)).toEqual(snapshot);
  });
});

describe("summariseIncidents", () => {
  it("counts open, critical and unassigned incidents", () => {
    const stats = summariseIncidents(incidents());
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.open).toBeGreaterThan(0);
    expect(stats.critical).toBeGreaterThanOrEqual(1);
    expect(stats.unassigned).toBeGreaterThanOrEqual(1);
  });

  it("computes MTTR only over resolved incidents", () => {
    const stats = summariseIncidents(incidents());
    expect(stats.mttrMs).not.toBeNull();
    expect(stats.mttrMs ?? 0).toBeGreaterThan(0);
  });

  it("returns a null MTTR when nothing has been resolved", () => {
    const openOnly = incidents().filter(isOpen);
    expect(summariseIncidents(openOnly).mttrMs).toBeNull();
  });
});

describe("incidentDuration", () => {
  it("measures an open incident against the supplied clock", () => {
    const open = incidents().find(isOpen);
    expect(open).toBeDefined();
    if (!open) return;
    expect(incidentDuration(open, NOW)).toBe(NOW - open.startedAt);
  });

  it("measures a resolved incident against its resolution, not the clock", () => {
    const resolved = incidents().find((incident) => incident.resolvedAt !== null);
    expect(resolved).toBeDefined();
    if (!resolved || resolved.resolvedAt === null) return;
    expect(incidentDuration(resolved, NOW + 10_000_000)).toBe(
      resolved.resolvedAt - resolved.startedAt,
    );
  });
});
