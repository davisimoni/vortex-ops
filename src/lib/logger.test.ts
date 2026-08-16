import { describe, expect, it } from "vitest";

import { Logger, redact, serialiseError, type LogLevel, type LogValue } from "@/lib/logger";

function capture(level: LogLevel = "debug") {
  const lines: string[] = [];
  const logger = new Logger({
    level,
    pretty: false,
    sink: (line) => {
      lines.push(line);
    },
  });
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe("redact", () => {
  it("masks keys that name a secret", () => {
    const output = redact({
      password: "hunter2",
      apiKey: "abc123",
      api_key: "abc123",
      authorization: "Basic xyz",
      metaAccessToken: "EAAG...",
      routingKeySignature: "v1=deadbeef",
      cookie: "session=1",
    }) as Record<string, unknown>;

    for (const value of Object.values(output)) {
      expect(value).toBe("[redacted]");
    }
  });

  it("leaves ordinary fields alone", () => {
    const output = redact({ incidentId: "INC-1", count: 3, ok: true }) as Record<string, unknown>;
    expect(output).toEqual({ incidentId: "INC-1", count: 3, ok: true });
  });

  it("masks bearer-shaped values wherever they appear", () => {
    // A token pasted into a field named `note` is still a token.
    expect(redact({ note: "Bearer eyJhbGciOi.J9.sig" })).toEqual({ note: "[redacted]" });
    expect(redact({ note: "xoxb-123-456-abcdef" })).toEqual({ note: "[redacted]" });
  });

  it("recurses into nested objects and arrays", () => {
    const output = redact({
      request: { headers: { authorization: "Bearer x" }, path: "/api" },
      items: [{ token: "t" }, { id: 2 }],
    }) as Record<string, Record<string, unknown>>;

    // The sensitive *leaf* is masked, not its whole container: the request path
    // is exactly the field you need when reading the log back.
    expect(output.request?.headers).toEqual({ authorization: "[redacted]" });
    expect(output.request?.path).toBe("/api");
    expect(output.items).toEqual([{ token: "[redacted]" }, { id: 2 }]);
  });

  it("stops at a depth limit so a deeply nested payload cannot run away", () => {
    let deep: LogValue = { value: "leaf" };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };

    expect(JSON.stringify(redact(deep))).toContain("[max depth]");
  });

  it("truncates long strings", () => {
    const long = "x".repeat(5_000);
    const output = redact({ body: long }) as { body: string };

    expect(output.body.length).toBeLessThan(long.length);
    expect(output.body).toContain("[+3000 chars]");
  });

  it("caps long arrays and says how many were dropped", () => {
    const array = Array.from({ length: 200 }, (_, index) => index);
    const capped = redact(array) as LogValue[];

    expect(capped).toHaveLength(51);
    expect(capped[50]).toBe("[+150 more]");
  });

  it("replaces non-finite numbers, which JSON would turn into null", () => {
    expect(redact({ ratio: Number.NaN })).toEqual({ ratio: "NaN" });
    expect(redact({ ratio: Number.POSITIVE_INFINITY })).toEqual({ ratio: "Infinity" });
  });
});

describe("Logger", () => {
  it("emits one JSON object per line with the stable base fields", () => {
    const { logger, records } = capture();
    logger.info("Incident opened", { incidentId: "INC-1" });

    const [record] = records();
    expect(record).toMatchObject({
      level: "info",
      msg: "Incident opened",
      incidentId: "INC-1",
    });
    expect(typeof record?.ts).toBe("string");
    expect(record?.service).toBeTruthy();
    expect(record?.env).toBeTruthy();
  });

  it("suppresses records below the configured level", () => {
    const { logger, lines } = capture("warn");
    logger.debug("noise");
    logger.info("noise");
    logger.warn("kept");
    logger.error("kept");
    expect(lines).toHaveLength(2);
  });

  it("stamps child bindings onto every record", () => {
    const { logger, records } = capture();
    logger.child({ requestId: "req_1" }).info("hello");
    expect(records()[0]?.requestId).toBe("req_1");
  });

  it("redacts context passed by the caller", () => {
    const { logger, records } = capture();
    logger.info("Delivering", { targetUrl: "https://x.test", authorization: "Bearer secret" });
    expect(records()[0]?.authorization).toBe("[redacted]");
    expect(records()[0]?.targetUrl).toBe("https://x.test");
  });

  it("unwraps errors into structured fields", () => {
    const { logger, records } = capture();
    logger.exception("Delivery failed", new TypeError("fetch failed"), { attempt: 2 });

    const record = records()[0];
    expect(record?.level).toBe("error");
    expect(record?.attempt).toBe(2);
    expect(record?.error).toMatchObject({ name: "TypeError", message: "fetch failed" });
  });

  it("handles a thrown non-Error", () => {
    expect(serialiseError("boom")).toMatchObject({ name: "NonError", message: "boom" });
  });

  it("times an operation and rethrows on failure", async () => {
    const { logger, records } = capture();

    await expect(
      logger.time("work", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    const record = records()[0];
    expect(record?.outcome).toBe("error");
    expect(typeof record?.durationMs).toBe("number");
  });

  it("returns the value on success", async () => {
    const { logger, records } = capture();
    const result = await logger.time("work", async () => 42);
    expect(result).toBe(42);
    expect(records()[0]?.outcome).toBe("ok");
  });
});
