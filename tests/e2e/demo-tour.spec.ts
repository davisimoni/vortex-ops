import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.describe("Quick Portfolio Tour", () => {
  test.use({ storageState: storageStatePath("acmeOwner") });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("is not shown until the visitor asks for it", async ({ page }) => {
    // No auto-opening modal on load — an unsolicited popup is a cost every
    // visitor pays, including the ones who came to read code, not click a tour.
    await expect(page.getByRole("dialog", { name: "Quick Portfolio Tour" })).toHaveCount(0);
  });

  test("opens on click and walks forward through all three steps", async ({ page }) => {
    await page.getByRole("button", { name: "Quick Portfolio Tour" }).click();

    const dialog = page.getByRole("dialog", { name: "Quick Portfolio Tour" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("RBAC simulator — live, not decorative")).toBeVisible();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("Chaos drill engine")).toBeVisible();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("Live logs & the public status page")).toBeVisible();

    // Last step: no more "Next", a "Done" instead.
    await expect(dialog.getByRole("button", { name: "Next" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("steps back with Back, disabled on the first step", async ({ page }) => {
    await page.getByRole("button", { name: "Quick Portfolio Tour" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick Portfolio Tour" });

    await expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByRole("button", { name: "Back" })).toBeEnabled();

    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(dialog.getByText("RBAC simulator — live, not decorative")).toBeVisible();
  });

  test("closes on Escape", async ({ page }) => {
    await page.getByRole("button", { name: "Quick Portfolio Tour" }).click();
    await expect(page.getByRole("dialog", { name: "Quick Portfolio Tour" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Quick Portfolio Tour" })).toHaveCount(0);
  });

  test("step 1's CTA actually previews as Viewer and lands on Team & access", async ({ page }) => {
    await page.getByRole("button", { name: "Quick Portfolio Tour" }).click();
    await page.getByRole("dialog", { name: "Quick Portfolio Tour" }).getByRole("button", { name: "Preview as Viewer" }).click();

    await expect(page).toHaveURL(/\/settings\/team$/);
    await expect(page.getByText(/Previewing as/)).toBeVisible();
    await expect(page.getByText("Viewer", { exact: true }).first()).toBeVisible();
  });

  test("step 2's CTA closes the tour and the chaos button is right there on the page", async ({ page }) => {
    await page.getByRole("button", { name: "Quick Portfolio Tour" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick Portfolio Tour" });
    await dialog.getByRole("button", { name: "Next" }).click();

    await dialog.getByRole("button", { name: "Show me the button" }).click();
    await expect(page.getByRole("dialog", { name: "Quick Portfolio Tour" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Simulate infrastructure failure" })).toBeVisible();
  });

  test("step 3's CTA opens the live log viewer", async ({ page }) => {
    await page.getByRole("button", { name: "Quick Portfolio Tour" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick Portfolio Tour" });
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Next" }).click();

    await dialog.getByRole("button", { name: "Open live logs" }).click();
    await expect(page).toHaveURL(/\/dashboard\/logs$/);
  });

  test("step 3 links to the public status page in a new tab", async ({ page, context }) => {
    await page.getByRole("button", { name: "Quick Portfolio Tour" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick Portfolio Tour" });
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Next" }).click();

    const [statusPage] = await Promise.all([
      context.waitForEvent("page"),
      dialog.getByRole("link", { name: /View public status page/ }).click(),
    ]);
    await statusPage.waitForLoadState();
    await expect(statusPage).toHaveURL(/\/status\/acme-corp$/);
  });
});
