import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

test.describe("Live metrics dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("lands signed-in users on the dashboard from the root", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("renders the health hero once client data has been generated", async ({ page }) => {
    await expect(page.getByRole("img", { name: /System health \d+ out of 100/ })).toBeVisible();
    await expect(page.getByText("Health score")).toBeVisible();
  });

  test("shows the four headline stat tiles", async ({ page }) => {
    for (const label of ["Latency p95", "CPU load", "5xx error rate", "Throughput"]) {
      await expect(page.getByRole("group", { name: label })).toBeVisible();
    }
  });

  test("scopes every chart with a single time-range control", async ({ page }) => {
    const rangeGroup = page.getByRole("radiogroup", { name: "Time range" });
    await expect(rangeGroup).toBeVisible();

    await rangeGroup.getByRole("radio", { name: "Last 7 days" }).check();
    await expect(page.getByText("Last 7 days · 168 points")).toBeVisible();

    await rangeGroup.getByRole("radio", { name: "Last hour" }).check();
    await expect(page.getByText("Last hour · 60 points")).toBeVisible();
  });

  test("offers a table view of every chart, so values never depend on hover", async ({ page }) => {
    await page
      .getByRole("radiogroup", { name: "API latency view" })
      .getByRole("radio", { name: "Table" })
      .check();

    const table = page.getByRole("table", { name: /API latency/ });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /p95/ })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /p99/ })).toBeVisible();
  });

  test("streams live samples that advance the current value", async ({ page }) => {
    await page
      .getByRole("radiogroup", { name: "Time range" })
      .getByRole("radio", { name: "Last hour" })
      .check();

    const tile = page.getByRole("group", { name: "Latency p95" });
    const initial = await tile.innerText();

    // Samples arrive every two seconds; give the stream several ticks before
    // judging it, since it only connects once the document has finished loading.
    await expect(async () => {
      expect(await tile.innerText()).not.toBe(initial);
    }).toPass({ timeout: 25_000 });
  });

  test("pauses and resumes the live stream", async ({ page }) => {
    const pause = page.getByRole("button", { name: "Pause live updates" });
    await pause.click();

    const resume = page.getByRole("button", { name: "Resume live updates" });
    await expect(resume).toHaveAttribute("aria-pressed", "true");

    await resume.click();
    await expect(page.getByRole("button", { name: "Pause live updates" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("shows the demo-mode storage badge in the E2E fixture environment", async ({ page, isMobile }) => {
    // The badge is header chrome hidden below the `sm` breakpoint, same as the
    // divider next to it — mobile's already-tight topbar keeps only the
    // always-relevant health/stream controls. /api/health carries the same
    // data unconditionally; see api.spec.ts.
    test.skip(isMobile, "Storage badge is sm+ only — see the topbar's other hidden-below-sm chrome.");

    // playwright.config.ts forces VORTEX_FORCE_MEMORY_STORAGE=1 for the web
    // server, so the "no database configured at all" badge is expected here —
    // not the "configured but unreachable" degraded state.
    await expect(page.getByText("Storage: Demo Mode")).toBeVisible();
  });
});

test.describe("Theme", () => {
  test.use({ storageState: storageStatePath("acmeOwner") });

  test("switches to dark and keeps it across a navigation", async ({ page }) => {
    await page.goto("/dashboard");

    await page
      .getByRole("radiogroup", { name: "Colour theme" })
      .getByRole("radio", { name: "Dark" })
      .click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.goto("/incidents");
    // The pre-paint bootstrap script must restore the choice with no flash.
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
