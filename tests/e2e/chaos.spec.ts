import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

/**
 * Runs against Stark, not Acme.
 *
 * Triggering the drill fires a real notification to every enabled integration
 * subscribed to `incident.opened` (see `notifyIntegrations`). Acme's seeded
 * integrations point at real Slack and PagerDuty hosts; Stark's two seeded
 * integrations are both `enabled: false`. Running here means the drill
 * resolves with zero outbound network calls — fast and deterministic, the
 * same reasoning `integrations.spec.ts` uses for its own "doomed webhook"
 * fixture rather than firing at a seeded destination.
 */
test.describe("Chaos engineering drill", () => {
  test.use({ storageState: storageStatePath("starkOwner") });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("requires confirmation before it does anything", async ({ page }) => {
    await page.getByRole("button", { name: "Simulate infrastructure failure" }).click();

    await expect(page.getByText("Opens a real incident and notifies your integrations.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm drill" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Confirm drill" })).toHaveCount(0);
  });

  test("opens a real CRITICAL incident and reports success", async ({ page }) => {
    await page.getByRole("button", { name: "Simulate infrastructure failure" }).click();
    await page.getByRole("button", { name: "Confirm drill" }).click();

    await expect(page.getByText("Chaos drill started")).toBeVisible();

    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: /CHAOS DRILL/ }).first()).toBeVisible();
  });

  test("survives a reload — the drill incident is really persisted", async ({ page }) => {
    await page.getByRole("button", { name: "Simulate infrastructure failure" }).click();
    await page.getByRole("button", { name: "Confirm drill" }).click();
    await expect(page.getByText("Chaos drill started")).toBeVisible();

    await page.goto("/incidents");
    await page.reload();
    await expect(page.getByRole("button", { name: /CHAOS DRILL/ }).first()).toBeVisible();
  });
});

test.describe("Chaos engineering drill — permissions", () => {
  test.use({ storageState: storageStatePath("acmeViewer") });

  test("is not offered to a role without chaos:trigger", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Simulate infrastructure failure" })).toHaveCount(0);
  });
});
