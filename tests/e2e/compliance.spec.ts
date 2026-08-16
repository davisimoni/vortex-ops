import { expect, request as apiRequest, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

test.describe("Compliance export", () => {
  test("is offered on the incidents page, the team page, and its own dedicated Audit & compliance page", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/incidents");
    await expect(page.getByRole("heading", { name: "Compliance export" })).toBeVisible();

    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Compliance export" })).toBeVisible();

    // Below `lg` the static rail is `display:none` (so absent from the a11y
    // tree entirely) and the drawer's own copy of the nav does not mount
    // until opened — the same way a real visitor on a phone would have to
    // open it to find this link.
    if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "Audit & compliance" })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: "Compliance export" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  });

  test("downloads a CSV with a sanitised, dated filename", async ({ page }) => {
    await page.goto("/incidents");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^vortex_acme-corp_incidents_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("switching format changes the download extension", async ({ page }) => {
    await page.goto("/incidents");

    await page
      .getByRole("radiogroup", { name: "Export format" })
      .getByRole("radio", { name: "JSON" })
      .check();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test("switching dataset changes what gets exported", async ({ page }) => {
    await page.goto("/incidents");

    await page.getByRole("button", { name: "Audit trail" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download" }).click(),
    ]);

    expect(download.suggestedFilename()).toContain("_audit_");
  });

  test("confirms the export happened via a toast", async ({ page }) => {
    await page.goto("/incidents");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    await downloadPromise;

    await expect(page.getByText("Export started")).toBeVisible();
  });

  test("is not offered to a Viewer", async ({ page }) => {
    // Real server-enforced check, using the demo role preview as a quick UI
    // smoke test; the actual 403 is covered directly against the API.
    await page.goto("/settings/team");
    await page.getByRole("button", { name: /Viewer/ }).first().click();

    await page.goto("/incidents");
    await expect(page.getByRole("heading", { name: "Compliance export" })).toHaveCount(0);

    // The nav link itself is gone too, and a direct visit explains why rather
    // than rendering an empty page.
    await expect(page.getByRole("link", { name: "Audit & compliance" })).toHaveCount(0);
    await page.goto("/audit");
    await expect(page.getByText("Your role does not include audit access")).toBeVisible();
  });
});

test.describe("Audit trail", () => {
  test("is visible on the team page for a role that can read it", async ({ page }) => {
    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  });

  test("shows a sign-in as one of the recorded events", async ({ page, request }) => {
    // Force at least one real, freshly-created audit event: a sign-in against
    // the API using this test's own request context, distinct from whatever
    // cookies the page already carries.
    await request.post("/api/auth/sign-in", {
      data: { email: "ada.okafor@vortex-ops.example", password: process.env.VORTEX_DEMO_PASSWORD ?? "vortex-demo-2026" },
    });

    await page.goto("/settings/team");
    await expect(page.getByText("Signed in").first()).toBeVisible();
  });

  test("records a denied action, not only successes", async ({ page, baseURL }) => {
    // A Viewer attempting to declare an incident directly against the API —
    // guaranteed denied, and it should show up on Acme's trail since Lena is
    // an Acme member. A fresh API context is needed here specifically because
    // it has to carry the *viewer's* cookies, not this test's owner session.
    const viewerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath("acmeViewer"),
    });
    await viewerContext.post("/api/incidents", {
      data: {
        title: "Should be denied",
        summary: "Attempted directly against the API by a Viewer.",
        serviceId: "api-gateway",
        severity: "warning",
      },
    });
    await viewerContext.dispose();

    await page.goto("/settings/team");
    await expect(page.getByText("denied").first()).toBeVisible();
  });
});
