import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

test.describe("Command palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("opens from the visible header button", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  });

  test("opens with Ctrl+K from anywhere in the app, not only the dashboard", async ({ page }) => {
    await page.goto("/integrations");
    // The global keydown listener attaches once React hydrates, which `load`
    // does not wait for — the same hydration race documented in auth.spec.ts.
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  });

  test("closes on Escape", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });

  test("lists pages, including /audit, /dashboard/logs and /integrations", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });

    await expect(dialog.getByRole("option", { name: /Audit & compliance/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /^Logs/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /^Integrations/ })).toBeVisible();
  });

  test("narrows results as the query changes", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });

    await page.getByLabel("Search commands").fill("topology");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option", { name: /Topology/ })).toBeVisible();
  });

  test("navigates to a page on selection and closes", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByLabel("Search commands").fill("topology");
    await page.getByRole("option", { name: /Topology/ }).click();

    await expect(page).toHaveURL(/\/dashboard\/topology$/);
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });

  test("selects the highlighted result with Enter", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByLabel("Search commands").fill("audit");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/audit$/);
  });

  test("lists a real open incident and jumps straight to its drawer", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });

    await page.getByLabel("Search commands").fill("API Gateway — 5xx");
    await dialog.getByRole("option", { name: /API Gateway — 5xx/ }).click();

    await expect(page).toHaveURL(/\/incidents$/);
    await expect(page.getByRole("dialog", { name: /API Gateway — 5xx/ })).toBeVisible();
  });

  test("offers a two-step confirm for the chaos drill, not an immediate trigger", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByRole("option", { name: "Trigger Chaos Drill" }).click();

    await expect(page.getByText("Trigger a real chaos drill?")).toBeVisible();
    // Not yet fired — no toast, no navigation.
    await expect(page.getByText("Chaos drill started")).toHaveCount(0);

    await page.getByRole("button", { name: "Confirm drill" }).click();
    await expect(page.getByText("Chaos drill started")).toBeVisible();
  });

  test("cancelling the chaos confirm returns to the list without triggering anything", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByRole("option", { name: "Trigger Chaos Drill" }).click();
    await expect(page.getByText("Trigger a real chaos drill?")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await expect(page.getByText("Chaos drill started")).toHaveCount(0);
  });

  test("is not offered to a Viewer", async ({ page }) => {
    await page.goto("/settings/team");
    await page.getByRole("button", { name: /Viewer/ }).first().click();

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).click();
    await expect(page.getByRole("option", { name: "Trigger Chaos Drill" })).toHaveCount(0);
  });

  test("offers switching organisation for an account with more than one", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByLabel("Search commands").fill("stark");
    await expect(page.getByRole("option", { name: /Switch to Stark Industries/ })).toBeVisible();
  });
});
