import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests run in the Node environment, not jsdom.
 *
 * Everything under test here is pure logic — the metric generator, the health
 * score, the RBAC table, the incident state machine, the SSRF guard, the payload
 * builders. None of it touches the DOM, and a jsdom environment would add
 * seconds of startup to every run for nothing. Browser behaviour is covered by
 * the Playwright suite instead, against a real browser.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts"],
    // Playwright specs use `@playwright/test`, which would collide with Vitest's
    // own `test` export if the runner picked them up.
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "./test-results/unit.xml" },
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts", "src/store/**/*.ts"],
    },
  },
});
