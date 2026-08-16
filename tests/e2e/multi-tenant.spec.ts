import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

/**
 * The organisation switcher is the multi-tenancy boundary made visible.
 * Ada Okafor is a member of both seeded organisations — Owner at Acme,
 * Viewer at Stark — which makes her the one account that can prove isolation
 * end to end: same person, same browser session, materially different data
 * and materially different authority depending only on which org is active.
 */
test.use({ storageState: storageStatePath("acmeOwner") });

test.describe("Organisation switcher", () => {
  test("shows the active organisation and environment in the header", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /Acme Corp.*Production/ })).toBeVisible();
  });

  test("lists every organisation the account belongs to", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Acme Corp/ }).click();

    const listbox = page.getByRole("listbox", { name: "Switch organisation" });
    await expect(listbox.getByRole("option", { name: /Acme Corp/ })).toBeVisible();
    await expect(listbox.getByRole("option", { name: /Stark Industries/ })).toBeVisible();
  });

  test("switching organisation is a full page reload, landing on the dashboard", async ({ page }) => {
    await page.goto("/incidents");
    await page.getByRole("button", { name: /Acme Corp/ }).click();
    await page.getByRole("option", { name: /Stark Industries/ }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: /Stark Industries.*Staging/ })).toBeVisible();
  });
});

test.describe("Data isolation across organisations", () => {
  test("Acme's incidents are not visible from Stark, and vice versa", async ({ page }) => {
    // The incident list renders twice — a stacked-card layout below `md`, a
    // table above it — and the responsive `display: none` half is removed
    // from the accessibility tree entirely, not merely hidden, so a
    // role-based query only ever matches whichever rendering is actually on
    // screen at the current viewport.
    await page.goto("/incidents");
    await expect(
      page.getByRole("button", { name: /API Gateway — 5xx error rate above 2%/ }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: /Acme Corp/ }).click();
    await page.getByRole("option", { name: /Stark Industries/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: /API Gateway — 5xx error rate above 2%/ })).toHaveCount(0);
    // Stark's own seeded incident is visible instead.
    await expect(page.getByRole("button", { name: /staging OIDC discovery/ }).first()).toBeVisible();
  });

  test("the dashboard's telemetry seed changes with the organisation", async ({ page }) => {
    await page.goto("/dashboard");
    // The health gauge only renders once the client-side generator has run,
    // so waiting on it is what separates "the real reading" from "whatever
    // placeholder happened to be in the DOM the instant we looked".
    await expect(page.getByText("Health score")).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "Time range" })
      .getByRole("radio", { name: "Last hour" })
      .check();
    const acmeValue = await page.getByRole("group", { name: "Latency p95" }).innerText();

    await page.getByRole("button", { name: /Acme Corp/ }).click();
    await page.getByRole("option", { name: /Stark Industries/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await expect(page.getByText("Health score")).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "Time range" })
      .getByRole("radio", { name: "Last hour" })
      .check();
    const starkValue = await page.getByRole("group", { name: "Latency p95" }).innerText();

    // Different seeds produce different simulated series — a visible signal
    // that this is not the same telemetry with a different label on top.
    expect(acmeValue).not.toBe(starkValue);
  });

  test("team rosters do not leak between organisations", async ({ page }) => {
    // Scoped to the member table specifically: the audit trail lower on the
    // same page can independently mention a name (e.g. Marco's own sign-in
    // from global-setup), which would make an unscoped page-wide text search
    // ambiguous.
    const roster = page.getByRole("table", { name: /Workspace members/ });

    await page.goto("/settings/team");
    await expect(roster.getByText("Marco Bellini")).toBeVisible();

    await page.getByRole("button", { name: /Acme Corp/ }).click();
    await page.getByRole("option", { name: /Stark Industries/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/settings/team");
    await expect(roster.getByText("Marco Bellini")).toHaveCount(0);
    await expect(roster.getByText("Nina Kovač")).toBeVisible();
  });

  test("integration lists do not leak between organisations", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: "#incidents" })).toBeVisible();

    await page.getByRole("button", { name: /Acme Corp/ }).click();
    await page.getByRole("option", { name: /Stark Industries/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: "#incidents" })).toHaveCount(0);
  });
});

test.describe("Role changes with the organisation", () => {
  test("the same account is Owner at Acme and Viewer at Stark", async ({ page }) => {
    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: "Declare incident" })).toBeVisible();

    await page.getByRole("button", { name: /Acme Corp/ }).click();
    await page.getByRole("option", { name: /Stark Industries/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: "Declare incident" })).toHaveCount(0);
  });
});
