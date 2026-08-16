import { describe, expect, it } from "vitest";

import { selectNotifiableIntegrations } from "@/server/notifications";
import type { Integration } from "@/types";

function integration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: "int_1",
    provider: "webhook",
    name: "Test destination",
    targetUrl: "https://ops.example.com/hooks/vortex",
    enabled: true,
    events: ["incident.opened"],
    minSeverity: "warning",
    createdAt: 0,
    lastDelivery: null,
    credentialHint: null,
    ...overrides,
  };
}

describe("selectNotifiableIntegrations", () => {
  it("excludes a disabled integration even if everything else matches", () => {
    const targets = selectNotifiableIntegrations([integration({ enabled: false })], {
      event: "incident.opened",
      severity: "critical",
    });
    expect(targets).toHaveLength(0);
  });

  it("excludes an integration not subscribed to this event", () => {
    const targets = selectNotifiableIntegrations(
      [integration({ events: ["incident.resolved"] })],
      { event: "incident.opened", severity: "critical" },
    );
    expect(targets).toHaveLength(0);
  });

  it("excludes an integration whose minimum severity is not met", () => {
    const targets = selectNotifiableIntegrations([integration({ minSeverity: "critical" })], {
      event: "incident.opened",
      severity: "warning",
    });
    expect(targets).toHaveLength(0);
  });

  it("includes an integration at exactly its minimum severity", () => {
    const targets = selectNotifiableIntegrations([integration({ minSeverity: "major" })], {
      event: "incident.opened",
      severity: "major",
    });
    expect(targets).toHaveLength(1);
  });

  it("includes an integration above its minimum severity", () => {
    const targets = selectNotifiableIntegrations([integration({ minSeverity: "warning" })], {
      event: "incident.opened",
      severity: "critical",
    });
    expect(targets).toHaveLength(1);
  });

  it("filters a mixed roster down to only the matching integrations", () => {
    const roster = [
      integration({ id: "a", enabled: true, events: ["incident.opened"], minSeverity: "warning" }),
      integration({ id: "b", enabled: false, events: ["incident.opened"], minSeverity: "warning" }),
      integration({ id: "c", enabled: true, events: ["incident.resolved"], minSeverity: "warning" }),
      integration({ id: "d", enabled: true, events: ["incident.opened"], minSeverity: "critical" }),
    ];

    const targets = selectNotifiableIntegrations(roster, {
      event: "incident.opened",
      severity: "critical",
    });

    expect(targets.map((entry) => entry.id)).toEqual(["a", "d"]);
  });
});
