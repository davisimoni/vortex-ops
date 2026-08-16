import { expect, test } from "@playwright/test";

/**
 * No `test.use({ storageState: ... })` anywhere in this file — the whole point
 * of this route is that it works with zero session cookie, unlike every other
 * page in the app.
 */
test.describe("Public status page", () => {
  test("shows live status, uptime history and incident history with no session", async ({ page }) => {
    await page.goto("/status/acme-corp");

    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
    // Exact match: the seeded "API Gateway — 5xx error rate above 2%" incident
    // also appears on this page and contains "API Gateway" as a substring.
    await expect(page.getByText("API Gateway", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: /Uptime — last \d+ days/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Incident history" })).toBeVisible();
  });

  test("shows an honest empty state for maintenance — no fabricated data", async ({ page }) => {
    await page.goto("/status/acme-corp");
    await expect(page.getByText("No scheduled maintenance.")).toBeVisible();
  });

  test("redacts internal detail from the incident timeline", async ({ page }) => {
    await page.goto("/status/acme-corp");

    // The seeded Acme incident's timeline includes an assignment entry
    // ("Assigned to Marco Bellini.") and a notification entry mentioning
    // Slack/PagerDuty by name — neither belongs on a page anyone can load.
    await expect(page.getByText("Assigned to Marco Bellini", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Notified #incidents on Slack", { exact: false })).toHaveCount(0);
  });

  test("serves a second organisation's status independently", async ({ page }) => {
    await page.goto("/status/stark-industries");
    await expect(page.getByRole("heading", { name: "Stark Industries" })).toBeVisible();
  });

  test("404s for a slug that does not exist, not a 500 or an empty page", async ({ page }) => {
    const response = await page.goto("/status/no-such-organisation-at-all");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("is not gated by the app's authentication layout", async ({ page }) => {
    // A bare visit must never bounce to /sign-in the way every other route does.
    await page.goto("/status/acme-corp");
    await expect(page).toHaveURL(/\/status\/acme-corp$/);
  });
});
