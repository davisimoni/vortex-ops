import { expect, test, type Page } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

/**
 * The incident list renders twice — stacked cards below `md`, a table above it
 * — and only one of the two is in the accessibility tree at a given viewport.
 * Selecting by role rather than by text therefore picks the rendering that is
 * actually on screen, and the same spec runs on both projects.
 */
function incidentRow(page: Page, title: string | RegExp) {
  return page.getByRole("button", { name: title }).first();
}

/**
 * Declares a fresh incident through the real UI and returns its title.
 *
 * Incidents are persisted server-side now, shared across every test that hits
 * this webServer (see the isolation note in playwright.config.ts). Mutating a
 * *seeded* incident from a test would make that test's outcome depend on
 * whatever earlier test — possibly from the other browser project — already
 * did to it. Declaring a fresh, uniquely-titled incident per test sidesteps
 * that entirely: nothing else in the suite can be holding a reference to it.
 */
async function declareTestIncident(page: Page): Promise<string> {
  const title = `E2E probe ${test.info().project.name} ${Date.now()}`;

  await page.goto("/incidents");
  await page.getByRole("button", { name: "Declare incident" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Summary").fill("Created by the Playwright suite for an isolated mutation test.");
  await page.getByRole("button", { name: "Declare incident" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  return title;
}

test.describe("Incident management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/incidents");
  });

  test("lists the seeded incidents with severity and status", async ({ page }) => {
    await expect(incidentRow(page, "API Gateway — 5xx error rate above 2%")).toBeVisible();
    await expect(page.getByText("Critical").filter({ visible: true }).first()).toBeVisible();
  });

  test("shows the headline incident stats", async ({ page }) => {
    await expect(page.getByText("Unassigned").first()).toBeVisible();
    await expect(page.getByText("MTTR").first()).toBeVisible();
  });

  test("filters by severity and clears again", async ({ page }) => {
    await page.getByRole("button", { name: "Warning", exact: true }).click();
    await expect(page.getByText(/of \d+ incidents match the current filters/)).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page.getByText(/of \d+ incidents match the current filters/)).toHaveCount(0);
  });

  test("shows an actionable empty state when filters exclude everything", async ({ page }) => {
    await page.getByRole("searchbox", { name: "Search incidents" }).fill("zzz-no-such-incident");
    await expect(page.getByText("No incidents match these filters")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" }).first()).toBeVisible();
  });

  test("shows the alert rules and their armed state", async ({ page }) => {
    // Exact match: the incident title embeds the rule name, and the two
    // renderings of the incident list mean the substring form is ambiguous.
    await expect(page.getByText("5xx error rate above 2%", { exact: true })).toBeVisible();
    await expect(page.getByText("p99 latency above 900 ms", { exact: true })).toBeVisible();
    await expect(page.getByText("CPU saturation above 85%", { exact: true })).toBeVisible();
    await expect(page.getByText("Armed").first()).toBeVisible();
  });

  test("declares a new incident and it appears at the top of the list, unassigned and investigating", async ({
    page,
  }) => {
    const title = await declareTestIncident(page);

    const drawer = page.getByRole("dialog");
    // The heading specifically, not a bare getByText(title): the AI Root
    // Cause Summary's explanation naturally references the incident by its
    // own title too, so an unscoped locator now matches both and trips
    // strict mode.
    await expect(drawer.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      drawer.getByRole("list", { name: "Incident lifecycle" }).getByRole("button", { name: "Investigating" }),
    ).toHaveAttribute("aria-current", "step");

    await page.keyboard.press("Escape");
    await expect(incidentRow(page, title)).toBeVisible();
  });

  test("rejects a title that is too short before it ever reaches the server", async ({ page }) => {
    await page.getByRole("button", { name: "Declare incident" }).click();
    await page.getByLabel("Title").fill("hi");
    await page.getByLabel("Summary").fill("Short title on purpose.");
    await page.getByRole("button", { name: "Declare incident" }).click();

    await expect(page.getByText("Give the incident a descriptive title.")).toBeVisible();
  });

  test("walks a freshly declared incident forward through its lifecycle", async ({ page }) => {
    await declareTestIncident(page);
    const drawer = page.getByRole("dialog");
    const stepper = drawer.getByRole("list", { name: "Incident lifecycle" });

    // Investigating cannot jump straight to Resolved.
    await expect(stepper.getByRole("button", { name: "Resolved" })).toBeDisabled();

    await stepper.getByRole("button", { name: "Identified" }).click();
    await expect(stepper.getByRole("button", { name: "Identified" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(drawer.getByText("Status changed from Investigating to Identified.")).toBeVisible();
  });

  test("assigns a responder and records it on the timeline", async ({ page }) => {
    await declareTestIncident(page);
    const drawer = page.getByRole("dialog");

    await drawer.getByLabel("Responder").selectOption("usr_priya");
    await expect(drawer.getByText(/Assigned to Priya Raman\./)).toBeVisible();
  });

  test("posts a note to the timeline", async ({ page }) => {
    await declareTestIncident(page);
    const drawer = page.getByRole("dialog");

    await drawer.getByLabel("Add a note").fill("Queue drained after the consumer restart.");
    await drawer.getByRole("button", { name: "Post note" }).click();

    // Scoped to the timeline entry specifically (a <p>, ARIA role
    // "paragraph"), not a plain text search: WebKit's accessibility tree
    // exposes a textbox's current value as matchable text too, and the
    // composer textarea can still contain the same string for a moment after
    // posting, which made an unscoped `getByText` ambiguous.
    await expect(drawer.getByRole("paragraph").filter({ hasText: "Queue drained after the consumer restart." })).toBeVisible();
    // The composer itself is cleared once the post succeeds.
    await expect(drawer.getByLabel("Add a note")).toHaveValue("");
  });

  test("closes the drawer with Escape", async ({ page }) => {
    await declareTestIncident(page);
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("survives a reload — incidents are actually persisted, not just in-memory client state", async ({
    page,
  }) => {
    const title = await declareTestIncident(page);
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(incidentRow(page, title)).toBeVisible();
  });
});
