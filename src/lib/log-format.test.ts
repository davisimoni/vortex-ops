import { describe, expect, it } from "vitest";

import { exportLogText, filterLogEntries, parseLogLine } from "@/lib/log-format";
import type { LogEntry } from "@/lib/log-schema";

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return { id: 1, capturedAt: "2026-01-01T00:00:00.000Z", level: "info", line: "hello", ...overrides };
}

describe("parseLogLine", () => {
  it("extracts ts, level, msg and the remaining fields from a JSON record", () => {
    const line = JSON.stringify({
      ts: "2026-01-01T00:00:05.000Z",
      level: "warn",
      msg: "Webhook delivered",
      service: "vortex-ops",
      env: "production",
      region: "eu-central-1",
      status: 200,
      durationMs: 84,
    });

    const parsed = parseLogLine(line);
    expect(parsed.ts).toBe("2026-01-01T00:00:05.000Z");
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("Webhook delivered");
    // Fields repeated on every line are dropped as noise for a live tail.
    expect(parsed.fields.some(([key]) => key === "service")).toBe(false);
    expect(parsed.fields.some(([key]) => key === "env")).toBe(false);
    expect(parsed.fields).toContainEqual(["status", "200"]);
    expect(parsed.fields).toContainEqual(["durationMs", "84"]);
  });

  it("stringifies a nested object field rather than dropping it", () => {
    const line = JSON.stringify({ msg: "Delivery failed", error: { name: "TypeError", message: "x" } });
    const parsed = parseLogLine(line);
    expect(parsed.fields).toContainEqual(["error", JSON.stringify({ name: "TypeError", message: "x" })]);
  });

  it("falls back to the raw line for malformed or non-JSON input", () => {
    const parsed = parseLogLine("not json at all");
    expect(parsed.ts).toBeNull();
    expect(parsed.level).toBeNull();
    expect(parsed.msg).toBe("not json at all");
    expect(parsed.fields).toEqual([]);
  });

  it("falls back to the raw line for a JSON array or primitive, not just malformed text", () => {
    expect(parseLogLine("[1,2,3]").msg).toBe("[1,2,3]");
    expect(parseLogLine("42").msg).toBe("42");
  });
});

describe("filterLogEntries", () => {
  const entries: LogEntry[] = [
    entry({ id: 1, level: "info", line: '{"msg":"Server started"}' }),
    entry({ id: 2, level: "warn", line: '{"msg":"Slow query detected"}' }),
    entry({ id: 3, level: "error", line: '{"msg":"Webhook delivery failed"}' }),
  ];

  it("keeps only entries whose level is in the allowed set", () => {
    const filtered = filterLogEntries(entries, new Set(["error"]), "");
    expect(filtered.map((e) => e.id)).toEqual([3]);
  });

  it("applies a case-insensitive text search over the raw line", () => {
    const filtered = filterLogEntries(entries, new Set(["info", "warn", "error"]), "WEBHOOK");
    expect(filtered.map((e) => e.id)).toEqual([3]);
  });

  it("combines the level and text filters", () => {
    const filtered = filterLogEntries(entries, new Set(["warn"]), "query");
    expect(filtered.map((e) => e.id)).toEqual([2]);
  });

  it("returns everything when the search query is blank", () => {
    const filtered = filterLogEntries(entries, new Set(["info", "warn", "error"]), "   ");
    expect(filtered).toHaveLength(3);
  });
});

describe("exportLogText", () => {
  it("joins raw lines with newlines, one entry per line", () => {
    const text = exportLogText([entry({ line: "a" }), entry({ line: "b" })]);
    expect(text).toBe("a\nb");
  });

  it("produces an empty string for no entries", () => {
    expect(exportLogText([])).toBe("");
  });
});
