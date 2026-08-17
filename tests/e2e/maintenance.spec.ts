import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

/** `datetime-local` input value in the browser's own local time. */
function localInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test.describe("Maintenance windows", () => {
  test("is seeded with at least one upcoming window on the incidents page", async ({ page }) => {
    await page.goto("/incidents");
    await expect(page.getByText("Maintenance windows")).toBeVisible();
    await expect(page.getByText("Postgres primary — replica failover rehearsal")).toBeVisible();
  });

  test("schedules a new window, and it appears immediately in the list", async ({ page }) => {
    const title = `E2E maintenance ${test.info().project.name} ${Date.now()}`;
    const start = new Date(Date.now() + 5 * 24 * 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);

    await page.goto("/incidents");
    await page.getByRole("button", { name: "Schedule maintenance" }).first().click();

    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill("Created by the Playwright suite.");
    await page.getByRole("button", { name: "API Gateway", exact: true }).click();
    await page.getByLabel("Starts").fill(localInputValue(start));
    await page.getByLabel("Ends").fill(localInputValue(end));

    await page.getByRole("button", { name: "Schedule maintenance" }).last().click();

    await expect(page.getByText("Maintenance scheduled")).toBeVisible();

    // Scoped to the list row, not a bare getByText: the confirmation toast
    // repeats the same title in its body and is still on screen at this
    // point, so an unscoped locator matches both and trips strict mode.
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText("Scheduled")).toBeVisible();
  });

  test("cancelling a window updates its status without removing it", async ({ page }) => {
    const title = `E2E cancel ${test.info().project.name} ${Date.now()}`;
    const start = new Date(Date.now() + 6 * 24 * 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);

    await page.goto("/incidents");
    await page.getByRole("button", { name: "Schedule maintenance" }).first().click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Payments", exact: true }).click();
    await page.getByLabel("Starts").fill(localInputValue(start));
    await page.getByLabel("Ends").fill(localInputValue(end));
    await page.getByRole("button", { name: "Schedule maintenance" }).last().click();

    const row = page.locator("li", { hasText: title });
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(row.getByText("Cancelled")).toBeVisible();
    await expect(row.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });

  test("is not offered to a Viewer", async ({ page }) => {
    await page.goto("/settings/team");
    await page.getByRole("button", { name: /Viewer/ }).first().click();

    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: "Schedule maintenance" })).toHaveCount(0);
  });

  test("a scheduled window syncs onto the public status page", async ({ page, request }) => {
    const title = `E2E status sync ${test.info().project.name} ${Date.now()}`;
    const start = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);

    await page.goto("/incidents");
    await page.getByRole("button", { name: "Schedule maintenance" }).first().click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Search Index", exact: true }).click();
    await page.getByLabel("Starts").fill(localInputValue(start));
    await page.getByLabel("Ends").fill(localInputValue(end));
    await page.getByRole("button", { name: "Schedule maintenance" }).last().click();
    await expect(page.getByText("Maintenance scheduled")).toBeVisible();

    const statusPage = await request.get("/status/acme-corp");
    expect(statusPage.ok()).toBe(true);
    expect(await statusPage.text()).toContain(title);
  });
});
