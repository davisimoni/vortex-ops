import { afterEach, describe, expect, it } from "vitest";

import { isProductionDeployment } from "@/lib/runtime-env";

const ORIGINAL_VORTEX_ENV = process.env.VORTEX_ENV;
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

afterEach(() => {
  if (ORIGINAL_VORTEX_ENV === undefined) delete process.env.VORTEX_ENV;
  else process.env.VORTEX_ENV = ORIGINAL_VORTEX_ENV;

  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
});

describe("isProductionDeployment", () => {
  it("is false with neither variable set — plain local development", () => {
    delete process.env.VORTEX_ENV;
    delete process.env.VERCEL_ENV;
    expect(isProductionDeployment()).toBe(false);
  });

  it("is true when the app's own VORTEX_ENV says production", () => {
    process.env.VORTEX_ENV = "production";
    delete process.env.VERCEL_ENV;
    expect(isProductionDeployment()).toBe(true);
  });

  it("is true on Vercel's production environment even if VORTEX_ENV was never set — the actual bug this exists to catch", () => {
    delete process.env.VORTEX_ENV;
    process.env.VERCEL_ENV = "production";
    expect(isProductionDeployment()).toBe(true);
  });

  it("is false for a Vercel preview deployment, which is not the public production URL", () => {
    delete process.env.VORTEX_ENV;
    process.env.VERCEL_ENV = "preview";
    expect(isProductionDeployment()).toBe(false);
  });

  it("does not fall back to NODE_ENV — a local `next build && next start` must not trip this", () => {
    delete process.env.VORTEX_ENV;
    delete process.env.VERCEL_ENV;
    const originalNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      expect(isProductionDeployment()).toBe(false);
    } finally {
      Object.assign(process.env, { NODE_ENV: originalNodeEnv });
    }
  });
});
