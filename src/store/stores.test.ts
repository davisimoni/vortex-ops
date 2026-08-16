import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api-client";
import {
  applyChaosMultiplier,
  applySampleToSeries,
  chaosMultiplier,
  useMetricsStore,
} from "@/store/metrics-store";
import { validateDraft, type IntegrationDraft } from "@/store/integration-store";
import type { MetricPoint } from "@/types";

const NOW = 1_700_000_000_000;

function point(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    t: NOW,
    latencyP50: 90,
    latencyP95: 190,
    latencyP99: 270,
    cpu: 40,
    errorRate: 0.05,
    throughput: 7_500,
    ...overrides,
  };
}

/*
 * Scope note: the incident, team and integration stores are now thin API
 * clients — `assign`, `transition`, `invite`, `create` and so on are `fetch`
 * calls that hand off to the server. The behaviour that used to live in those
 * store methods (the transition state machine, last-owner protection, RBAC,
 * credential handling) now lives server-side and is covered directly against
 * `MemoryRepository` in `src/server/repository/memory.test.ts`, plus the API
 * routes end-to-end in `tests/e2e`. What is tested here is what still runs
 * entirely in the browser: pure client-side logic with no network involved.
 */

describe("applySampleToSeries", () => {
  it("appends and scrolls the 1-hour window", () => {
    const series = Array.from({ length: 60 }, (_, index) => point({ t: NOW + index }));
    const next = applySampleToSeries(series, point({ t: NOW + 999 }), "1h");

    expect(next).toHaveLength(60);
    expect(next[59]?.t).toBe(NOW + 999);
    expect(next[0]?.t).toBe(NOW + 1);
  });

  it("updates the trailing bucket on wider ranges instead of appending", () => {
    // One live sample is a fraction of a 6-hour bucket. Appending it would
    // silently change the axis resolution.
    const series = [point({ t: 1 }), point({ t: 2 }), point({ t: 3 })];
    const next = applySampleToSeries(series, point({ t: 99, cpu: 88 }), "30d");

    expect(next).toHaveLength(3);
    expect(next[2]?.t).toBe(3);
    expect(next[2]?.cpu).toBe(88);
  });

  it("seeds an empty series with the first sample", () => {
    expect(applySampleToSeries([], point(), "24h")).toHaveLength(1);
  });
});

describe("metrics store", () => {
  beforeEach(() => {
    useMetricsStore.setState({ series: [], ready: false, paused: false, range: "24h", seed: 1_337 });
  });

  it("generates a series on initialise, seeded per organisation", () => {
    useMetricsStore.getState().initialise(4_242, NOW);
    expect(useMetricsStore.getState().ready).toBe(true);
    expect(useMetricsStore.getState().seed).toBe(4_242);
    expect(useMetricsStore.getState().series.length).toBeGreaterThan(0);
  });

  it("does not discard live samples when re-initialised with the same seed", () => {
    // A component re-mounting with the same organisation must not throw away
    // history the live stream has already collected.
    useMetricsStore.getState().initialise(4_242, NOW);
    useMetricsStore.getState().applySample(point({ t: NOW + 999_999, cpu: 77 }));
    const before = useMetricsStore.getState().series.at(-1);

    useMetricsStore.getState().initialise(4_242, NOW + 5_000);

    expect(useMetricsStore.getState().series.at(-1)).toEqual(before);
  });

  it("regenerates history when the seed changes — switching tenants resets telemetry", () => {
    useMetricsStore.getState().initialise(4_242, NOW);
    const acmeSeries = useMetricsStore.getState().series;

    useMetricsStore.getState().initialise(9_001, NOW);

    expect(useMetricsStore.getState().seed).toBe(9_001);
    expect(useMetricsStore.getState().series).not.toEqual(acmeSeries);
  });

  it("ignores samples while paused, so a frozen chart stays frozen", () => {
    useMetricsStore.getState().initialise(1_337, NOW);
    const before = useMetricsStore.getState().series.at(-1);

    useMetricsStore.setState({ paused: true });
    useMetricsStore.getState().applySample(point({ t: NOW + 5_000, cpu: 99 }));

    expect(useMetricsStore.getState().series.at(-1)).toEqual(before);
  });

  it("regenerates history when the range changes, keeping the same seed", () => {
    useMetricsStore.getState().initialise(1_337, NOW);
    useMetricsStore.getState().setRange("7d");

    expect(useMetricsStore.getState().range).toBe("7d");
    expect(useMetricsStore.getState().series).toHaveLength(168);
  });
});

describe("chaosMultiplier", () => {
  it("is null with no active drill", () => {
    expect(chaosMultiplier(null, NOW)).toBeNull();
  });

  it("peaks at the moment the drill starts", () => {
    const spike = { startedAt: NOW, durationMs: 10_000 };
    expect(chaosMultiplier(spike, NOW)).toBe(4);
  });

  it("decays linearly toward 1 as the drill runs", () => {
    const spike = { startedAt: NOW, durationMs: 10_000 };
    expect(chaosMultiplier(spike, NOW + 5_000)).toBeCloseTo(2.5, 5);
  });

  it("expires once the duration has fully elapsed, returning null", () => {
    const spike = { startedAt: NOW, durationMs: 10_000 };
    expect(chaosMultiplier(spike, NOW + 10_000)).toBeNull();
    expect(chaosMultiplier(spike, NOW + 20_000)).toBeNull();
  });
});

describe("applyChaosMultiplier", () => {
  it("inflates error rate, tail latency and (dampened) CPU", () => {
    const base = point({ errorRate: 1, latencyP95: 200, latencyP99: 300, cpu: 40 });
    const spiked = applyChaosMultiplier(base, 3);

    expect(spiked.errorRate).toBe(3);
    expect(spiked.latencyP95).toBe(600);
    expect(spiked.latencyP99).toBe(900);
    // CPU is dampened relative to the raw factor — a 3x multiplier does not
    // triple CPU, or every drill would instantly pin it at the 100% clamp.
    expect(spiked.cpu).toBe(80);
    expect(spiked.cpu).toBeLessThan(base.cpu * 3);
  });

  it("clamps error rate and CPU at 100, never producing an out-of-range metric", () => {
    const base = point({ errorRate: 50, cpu: 90 });
    const spiked = applyChaosMultiplier(base, 4);

    expect(spiked.errorRate).toBeLessThanOrEqual(100);
    expect(spiked.cpu).toBeLessThanOrEqual(100);
  });

  it("leaves latency p50 and throughput untouched — the drill targets errors and tail latency", () => {
    const base = point({ latencyP50: 90, throughput: 5_000 });
    const spiked = applyChaosMultiplier(base, 3);

    expect(spiked.latencyP50).toBe(base.latencyP50);
    expect(spiked.throughput).toBe(base.throughput);
  });
});

describe("metrics store — chaos drill", () => {
  beforeEach(() => {
    useMetricsStore.setState({
      series: [],
      ready: false,
      paused: false,
      range: "24h",
      seed: 1_337,
      chaosSpike: null,
    });
  });

  it("triggerChaosSpike records a drill starting now, with the given duration", () => {
    useMetricsStore.getState().triggerChaosSpike(10_000);
    const spike = useMetricsStore.getState().chaosSpike;

    expect(spike?.durationMs).toBe(10_000);
    expect(spike?.startedAt).toBeCloseTo(Date.now(), -2);
  });

  it("inflates incoming samples for the duration of a triggered drill", () => {
    useMetricsStore.getState().initialise(1_337, NOW);
    useMetricsStore.setState({ chaosSpike: { startedAt: NOW, durationMs: 10_000 } });

    useMetricsStore.getState().applySample(point({ t: NOW + 1, errorRate: 1 }));

    const latest = useMetricsStore.getState().series.at(-1);
    expect(latest?.errorRate).toBeGreaterThan(1);
  });

  it("clears the drill once it decays, so later samples are unaffected", () => {
    useMetricsStore.getState().initialise(1_337, NOW);
    useMetricsStore.setState({ chaosSpike: { startedAt: NOW, durationMs: 1_000 } });

    useMetricsStore.getState().applySample(point({ t: NOW + 5_000, errorRate: 1 }));

    expect(useMetricsStore.getState().chaosSpike).toBeNull();
    expect(useMetricsStore.getState().series.at(-1)?.errorRate).toBe(1);
  });
});

describe("integration draft validation (client pre-flight)", () => {
  const base: IntegrationDraft = {
    provider: "webhook",
    name: "Status page sync",
    targetUrl: "https://status.example.com/hooks/vortex",
    events: ["incident.opened"],
    minSeverity: "major",
    enabled: true,
  };

  it("accepts a well-formed draft for a provider that needs no credential", () => {
    expect(validateDraft(base).ok).toBe(true);
  });

  it("requires a name", () => {
    expect(validateDraft({ ...base, name: " " }).ok).toBe(false);
  });

  it("requires at least one event", () => {
    const result = validateDraft({ ...base, events: [] });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("never fire");
  });

  it("rejects a private destination client-side, before it ever reaches the server", () => {
    expect(validateDraft({ ...base, targetUrl: "https://127.0.0.1/hook" }).ok).toBe(false);
  });

  it("enforces the provider host allowlist", () => {
    expect(
      validateDraft({ ...base, provider: "slack", targetUrl: "https://evil.test/hook" }).ok,
    ).toBe(false);
    expect(
      validateDraft({
        ...base,
        provider: "slack",
        targetUrl: "https://hooks.slack.com/services/T/B/X",
      }).ok,
    ).toBe(true);
  });

  it("requires a token for a credentialed provider", () => {
    const result = validateDraft({
      ...base,
      provider: "pagerduty",
      targetUrl: "https://events.eu.pagerduty.com/v2/enqueue",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Routing key");
  });

  it("accepts a credentialed provider once a token is present", () => {
    const result = validateDraft({
      ...base,
      provider: "pagerduty",
      targetUrl: "https://events.eu.pagerduty.com/v2/enqueue",
      credential: { token: "R0ABCDEF" },
    });
    expect(result.ok).toBe(true);
  });

  it("requires both a token and a destination for Telegram, and skips URL validation", () => {
    const missingDestination = validateDraft({
      ...base,
      provider: "telegram",
      targetUrl: "",
      credential: { token: "123:abc" },
    });
    expect(missingDestination.ok).toBe(false);
    expect(missingDestination.message).toContain("Chat ID");

    const complete = validateDraft({
      ...base,
      provider: "telegram",
      targetUrl: "",
      credential: { token: "123:abc", destination: "-100123456" },
    });
    expect(complete.ok).toBe(true);
  });
});

describe("api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces a network failure distinctly from a server-reported one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    const result = await apiFetch("/api/incidents");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.error).toBe("network_error");
      expect(result.failure.status).toBe(0);
    }
  });

  it("carries the server's error shape through on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: "forbidden", message: "no", requiredPermission: "incident:create" }),
            { status: 403 },
          ),
        ),
      ),
    );

    const result = await apiFetch("/api/incidents");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.status).toBe(403);
      expect(result.failure.requiredPermission).toBe("incident:create");
    }
  });

  it("resolves the parsed body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))),
    );

    const result = await apiFetch<{ ok: boolean }>("/api/incidents");

    expect(result).toEqual({ ok: true, data: { ok: true } });
  });
});
