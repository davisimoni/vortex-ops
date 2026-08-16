import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * End-to-end suite.
 *
 * Runs against a production build, not the dev server: the dev server tolerates
 * things a real deployment does not (unoptimised hydration, different error
 * overlays), and an E2E suite that only passes in dev is worth very little.
 *
 * The web server runs with `DATABASE_URL` explicitly cleared, forcing the
 * in-process storage fallback rather than whatever the shell's ambient
 * environment happens to have set. That makes the suite self-contained (no
 * database to provision in CI) and, more importantly, deterministic: every run
 * starts from the same seeded fixtures.
 *
 * That fallback is also *shared, mutable, process-wide state* — unlike the
 * pre-persistence version of this app, where every browser context held its
 * own isolated client-side store. One incident created by spec A is visible to
 * spec B if they run concurrently against the same server process. `workers: 1`
 * trades parallelism for that correctness; it is not a performance accident.
 *
 * `globalSetup` signs in every demo account once and saves its session as a
 * storage-state file, so individual specs start already authenticated instead
 * of repeating the sign-in form flow at the top of every test.
 *
 * Two projects — desktop Chromium and mobile Safari — because a significant
 * share of on-call work happens on a phone, and the incident table renders
 * through a different code path below the `md` breakpoint.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/e2e.xml" }]]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],

  webServer: {
    command: "npm run start",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // Force the in-memory driver — see the module comment above.
      DATABASE_URL: "",
      VORTEX_SESSION_SECRET: "e2e-session-secret-not-for-production-use-0123456789",
      // 64 hex chars = 32 bytes, as `src/server/crypto/secrets.ts` requires.
      VORTEX_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  },
});
