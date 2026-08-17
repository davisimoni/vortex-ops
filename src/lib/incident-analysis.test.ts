import { describe, expect, it } from "vitest";

import { analyzeIncident } from "@/lib/incident-analysis";
import type { Incident } from "@/types";

const NOW = 1_700_000_000_000;

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "INC-2411",
    title: "API Gateway — 5xx error rate above 2%",
    summary: "",
    serviceId: "api-gateway",
    severity: "critical",
    status: "investigating",
    assigneeId: null,
    startedAt: NOW - 30 * 60_000,
    resolvedAt: null,
    ruleId: "rule_5xx_critical",
    impactedRequests: 1_000,
    timeline: [],
    ...overrides,
  };
}

describe("analyzeIncident", () => {
  it("is deterministic — the same incident produces the exact same analysis every time", () => {
    const a = analyzeIncident(incident(), NOW);
    const b = analyzeIncident(incident(), NOW);
    expect(a).toEqual(b);
  });

  it("gives a different headline for a different service, not one static block of text", () => {
    const gateway = analyzeIncident(incident({ serviceId: "api-gateway" }), NOW);
    const db = analyzeIncident(incident({ id: "INC-2412", serviceId: "postgres-primary" }), NOW);
    expect(gateway.headline).not.toBe(db.headline);
    expect(gateway.commands).not.toEqual(db.commands);
  });

  it("always returns exactly two remediation commands", () => {
    const analysis = analyzeIncident(incident(), NOW);
    expect(analysis.commands).toHaveLength(2);
    for (const entry of analysis.commands) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.command.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a generic profile for a service with no authored profile", () => {
    expect(() => analyzeIncident(incident({ serviceId: "some-future-service" }), NOW)).not.toThrow();
  });

  it("keeps confidence within [30, 97]", () => {
    for (const severity of ["critical", "major", "warning"] as const) {
      for (const id of ["INC-0001", "INC-9999", "INC-4242", "a", "zzzzzz"]) {
        const analysis = analyzeIncident(incident({ id, severity }), NOW);
        expect(analysis.confidencePct).toBeGreaterThanOrEqual(30);
        expect(analysis.confidencePct).toBeLessThanOrEqual(97);
      }
    }
  });

  it("weights a critical incident with higher confidence than an otherwise-identical warning", () => {
    const critical = analyzeIncident(incident({ severity: "critical", id: "INC-A" }), NOW);
    const warning = analyzeIncident(incident({ severity: "warning", id: "INC-A" }), NOW);
    expect(critical.confidencePct).toBeGreaterThan(warning.confidencePct);
  });

  it("mentions the incident's actual duration and impacted-request count in the explanation", () => {
    const analysis = analyzeIncident(incident({ startedAt: NOW - 90 * 60_000, impactedRequests: 42_000 }), NOW);
    expect(analysis.explanation).toContain("42,000");
    expect(analysis.explanation).toMatch(/1h 30m|90m/);
  });

  it("distinguishes a rule-triggered incident from a manually declared one in the explanation", () => {
    const auto = analyzeIncident(incident({ ruleId: "rule_x" }), NOW);
    const manual = analyzeIncident(incident({ ruleId: null }), NOW);
    expect(auto.explanation).toContain("automatically");
    expect(manual.explanation).toContain("manually");
  });
});
