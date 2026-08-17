import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

test.describe("Service topology", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/topology");
    // The graph only renders once both the incident store's fetch and the
    // metrics store's client-side init have landed — wait past that instead
    // of racing it, the same hydration-timing fix used in auth.spec.ts.
    await page.waitForLoadState("networkidle");
  });

  test("is reachable from the sidebar nav", async ({ page, isMobile }) => {
    await page.goto("/dashboard");
    if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Topology", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/topology$/);
  });

  test("is reachable from the dashboard's quick link", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "View topology" }).click();
    await expect(page).toHaveURL(/\/dashboard\/topology$/);
  });

  test("renders every monitored service as a node", async ({ page }) => {
    for (const name of ["API Gateway", "Auth Service", "Payments", "Search Index", "Postgres Primary", "Notifications"]) {
      await expect(page.getByRole("button", { name: new RegExp(name) }).first()).toBeVisible();
    }
  });

  test("flags the API Gateway node with an open-incident marker for its real, currently-open critical incident", async ({
    page,
  }) => {
    // INC-2411 (seeded, critical, open) belongs to api-gateway — the warning
    // triangle only renders when openIncidentCount > 0, so its presence here
    // is a real assertion about the seeded data, not decoration.
    const gatewayNode = page.getByRole("button", { name: /API Gateway/ }).first();
    await expect(gatewayNode.locator("svg")).toHaveCount(1);
  });

  test("does not flag a node with no open incidents", async ({ page }) => {
    // Payments' only seeded incident (INC-2398) is resolved.
    const paymentsNode = page.getByRole("button", { name: /^Payments/ }).first();
    await expect(paymentsNode.locator("svg")).toHaveCount(0);
  });

  test("clicking a node opens a detail panel with its real open incidents", async ({ page }) => {
    await page.getByRole("button", { name: /API Gateway/ }).first().click();

    const dialog = page.getByRole("dialog", { name: "API Gateway" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Open incidents")).toBeVisible();
    await expect(dialog.getByText("API Gateway — 5xx error rate above 2%")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("lists a real open incident for Notifications, seeded as still investigating", async ({ page }) => {
    await page.getByRole("button", { name: /Notifications/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog.getByText("Notifications — webhook delivery backlog")).toBeVisible();
  });

  test("shows the honest empty state for a service with no open incidents", async ({ page }) => {
    await page.getByRole("button", { name: /^Payments/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Payments" });
    await expect(dialog.getByText("No open incidents on this service.")).toBeVisible();
  });
});
