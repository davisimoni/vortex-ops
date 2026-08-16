import { afterEach, describe, expect, it } from "vitest";

import { pushLogEntry, recentLogEntries, resetLogBuffer, subscribeToLogs } from "@/lib/log-buffer";

afterEach(() => {
  resetLogBuffer();
});

describe("pushLogEntry / recentLogEntries", () => {
  it("returns entries oldest first, with a monotonic id", () => {
    pushLogEntry('{"msg":"one"}', "info");
    pushLogEntry('{"msg":"two"}', "warn");

    const entries = recentLogEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.line).toContain("one");
    expect(entries[1]?.line).toContain("two");
    expect(entries[1]!.id).toBeGreaterThan(entries[0]!.id);
  });

  it("caps the requested backlog to the most recent entries", () => {
    for (let i = 0; i < 5; i += 1) pushLogEntry(`{"msg":"${i}"}`, "info");

    const lastTwo = recentLogEntries(2);
    expect(lastTwo).toHaveLength(2);
    expect(lastTwo[0]?.line).toContain("3");
    expect(lastTwo[1]?.line).toContain("4");
  });

  it("stamps the level onto the entry", () => {
    pushLogEntry("boom", "error");
    expect(recentLogEntries()[0]?.level).toBe("error");
  });
});

describe("ring buffer eviction", () => {
  it("does not grow without bound — old entries are evicted past the cap", () => {
    // The cap is internal (2,000); pushing well past it must not throw or
    // silently keep everything.
    for (let i = 0; i < 2_500; i += 1) pushLogEntry(`{"seq":${i}}`, "info");

    const entries = recentLogEntries(10_000);
    expect(entries.length).toBeLessThanOrEqual(2_000);
    // The oldest surviving entry is not #0 — it was evicted.
    expect(entries[0]?.line).not.toContain('"seq":0}');
  });
});

describe("subscribeToLogs", () => {
  it("notifies every subscriber of each pushed entry", () => {
    const seenA: string[] = [];
    const seenB: string[] = [];
    const unsubA = subscribeToLogs((entry) => seenA.push(entry.line));
    const unsubB = subscribeToLogs((entry) => seenB.push(entry.line));

    pushLogEntry("line one", "info");

    expect(seenA).toEqual(["line one"]);
    expect(seenB).toEqual(["line one"]);

    unsubA();
    pushLogEntry("line two", "info");

    expect(seenA).toEqual(["line one"]);
    expect(seenB).toEqual(["line one", "line two"]);

    unsubB();
  });

  it("does not let one broken subscriber stop delivery to the others", () => {
    const seen: string[] = [];
    subscribeToLogs(() => {
      throw new Error("subscriber blew up");
    });
    subscribeToLogs((entry) => seen.push(entry.line));

    expect(() => pushLogEntry("still delivered", "info")).not.toThrow();
    expect(seen).toEqual(["still delivered"]);
  });
});
