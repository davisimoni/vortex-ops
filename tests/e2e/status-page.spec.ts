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
    // Stark, not Acme: Acme is seeded with a real upcoming maintenance window
    // (see the next test) specifically so this page has something real to
    // show — Stark has none, which is what makes it the right fixture for
    // proving the empty state is not just always-on decoration.
    await page.goto("/status/stark-industries");
    await expect(page.getByText("No scheduled maintenance.")).toBeVisible();
  });

  test("shows a real scheduled maintenance window, not a fabricated one", async ({ page }) => {
    await page.goto("/status/acme-corp");
    // The seed has one upcoming window and one completed three days ago —
    // both within the 7-day completed-retention window, so both are real,
    // present data, not a fabricated calendar.
    await expect(page.getByText("Postgres primary — replica failover rehearsal")).toBeVisible();
    await expect(page.getByText("Scheduled").first()).toBeVisible();
    await expect(page.getByText("API Gateway — TLS certificate rotation")).toBeVisible();
    await expect(page.getByText("Completed").first()).toBeVisible();
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
    // Unlike every route under (app), a bare visit here must never redirect
    // anywhere at all — not to a demo session, not to sign-in. No cookie
    // should be set by loading this page.
    await page.goto("/status/acme-corp");
    await expect(page).toHaveURL(/\/status\/acme-corp$/);
    expect((await page.context().cookies()).length).toBe(0);
  });
});
