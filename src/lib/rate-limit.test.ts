import { afterEach, describe, expect, it, vi } from "vitest";

import { clientKey, rateLimit, resetRateLimits } from "@/lib/rate-limit";

afterEach(() => {
  resetRateLimits();
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows requests up to the limit and refuses the next one", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit("key", 3, 60_000).allowed).toBe(true);
    }
    expect(rateLimit("key", 3, 60_000).allowed).toBe(false);
  });

  it("counts down the remaining allowance", () => {
    expect(rateLimit("key", 3, 60_000).remaining).toBe(2);
    expect(rateLimit("key", 3, 60_000).remaining).toBe(1);
    expect(rateLimit("key", 3, 60_000).remaining).toBe(0);
  });

  it("keeps separate counters per key", () => {
    rateLimit("a", 1, 60_000);
    expect(rateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("reports a retry-after once the window is exhausted", () => {
    rateLimit("key", 1, 60_000);
    const blocked = rateLimit("key", 1, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);
  });

  it("opens a fresh window once the old one expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    rateLimit("key", 1, 60_000);
    expect(rateLimit("key", 1, 60_000).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(rateLimit("key", 1, 60_000).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const request = new Request("https://x.test", {
      headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18" },
    });
    expect(clientKey(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    const request = new Request("https://x.test", { headers: { "x-real-ip": "198.51.100.7" } });
    expect(clientKey(request)).toBe("198.51.100.7");
  });

  it("degrades to a shared bucket rather than throwing", () => {
    expect(clientKey(new Request("https://x.test"))).toBe("anonymous");
  });
});
