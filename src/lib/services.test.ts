import { describe, expect, it } from "vitest";

import { getService, pickRandomService, SERVICES, serviceName } from "@/lib/services";

describe("pickRandomService", () => {
  it("picks the first service when the rng returns 0", () => {
    expect(pickRandomService(() => 0)).toEqual(SERVICES[0]);
  });

  it("picks the last service when the rng returns just under 1", () => {
    expect(pickRandomService(() => 0.999_999)).toEqual(SERVICES[SERVICES.length - 1]);
  });

  it("never indexes past the end even if the rng returns exactly 1", () => {
    // Math.random() never actually returns 1, but a stub in a test might.
    expect(pickRandomService(() => 1)).toEqual(SERVICES[SERVICES.length - 1]);
  });

  it("distributes across the full roster given a spread of inputs", () => {
    const picked = new Set(
      SERVICES.map((_, index) => pickRandomService(() => index / SERVICES.length).id),
    );
    expect(picked.size).toBe(SERVICES.length);
  });
});

describe("getService / serviceName", () => {
  it("resolves a known service", () => {
    expect(getService("api-gateway")?.name).toBe("API Gateway");
    expect(serviceName("api-gateway")).toBe("API Gateway");
  });

  it("falls back to the raw id for an unknown service rather than throwing", () => {
    expect(getService("does-not-exist")).toBeUndefined();
    expect(serviceName("does-not-exist")).toBe("does-not-exist");
  });
});
