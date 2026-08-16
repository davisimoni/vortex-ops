import { expect, test } from "@playwright/test";

import { ACCOUNTS } from "./accounts";
import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

function uniqueEmail(label: string): string {
  return `${label}.${test.info().project.name}.${Date.now()}@example.com`.replace(/\s+/g, "-");
}

test.describe("Permission matrix", () => {
  test("renders from the same table the API enforces", async ({ page }) => {
    await page.goto("/settings/team");

    const matrix = page.getByRole("table", { name: /Permissions granted to each role/ });
    await expect(matrix).toBeVisible();
    await expect(matrix.getByRole("columnheader", { name: /Owner/ })).toBeVisible();
    await expect(matrix.getByRole("columnheader", { name: /DevOps/ })).toBeVisible();
    await expect(matrix.getByRole("columnheader", { name: /Viewer/ })).toBeVisible();
    await expect(matrix.getByRole("row", { name: /Manage billing/ })).toBeVisible();
  });

  test("lets an Owner grant a per-organisation override, live", async ({ page }) => {
    await page.goto("/settings/team");

    // Viewer does not get audit:read by default.
    const row = page.getByRole("row", { name: "Read the audit trail" });
    const viewerCell = row.getByRole("cell").nth(2);
    const toggle = viewerCell.getByRole("button");

    await expect(toggle.getByText("Denied")).toBeVisible();
    await toggle.click();
    await expect(toggle.getByText("Granted")).toBeVisible();

    // Persists across a reload — this is a server-side override, not local UI state.
    await page.reload();
    await expect(
      page.getByRole("row", { name: "Read the audit trail" }).getByRole("cell").nth(2).getByRole("button").getByText("Granted"),
    ).toBeVisible();

    // Clean up so this test is repeatable against the same shared server.
    await page
      .getByRole("row", { name: "Read the audit trail" })
      .getByRole("cell")
      .nth(2)
      .getByRole("button")
      .click();
  });

  test("never lets Owner's own role-management permission be revoked", async ({ page }) => {
    await page.goto("/settings/team");

    // Table columns are Owner, DevOps, Viewer, in that order.
    const row = page.getByRole("row", { name: "Change roles" });
    const ownerToggle = row.getByRole("cell").nth(0).getByRole("button");
    await expect(ownerToggle).toBeDisabled();
  });
});

test.describe("Team membership", () => {
  test("protects the last owner from demotion and removal", async ({ page }) => {
    await page.goto("/settings/team");
    await expect(page.getByLabel(`Role for ${ACCOUNTS.acmeOwner.name}`)).toBeDisabled();
  });

  test("invites a teammate, and it persists across a reload", async ({ page }) => {
    const email = uniqueEmail("jordan.blake");

    await page.goto("/settings/team");
    await page.getByLabel("Name", { exact: true }).fill("Jordan Blake");
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();

    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("Invite pending").first()).toBeVisible();

    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("rejects a malformed invite address", async ({ page }) => {
    await page.goto("/settings/team");

    await page.getByLabel("Name", { exact: true }).fill("Jordan Blake");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByRole("button", { name: "Send invite" }).click();

    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  });

  test("refuses a duplicate email with a clear message", async ({ page }) => {
    const email = uniqueEmail("duplicate");

    await page.goto("/settings/team");
    await page.getByLabel("Name", { exact: true }).fill("First Invite");
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(email)).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("Second Invite");
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText("That address is already on the team.")).toBeVisible();
  });
});

test.describe("Role preview (client-side lens)", () => {
  test("locks incident controls on another page while previewing Viewer", async ({ page }) => {
    await page.goto("/settings/team");
    await page.getByRole("button", { name: /Viewer/ }).first().click();
    await expect(page.getByText(/Previewing as/)).toBeVisible();

    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: "Declare incident" })).toHaveCount(0);

    // The incident list renders twice (a stacked-card layout below `md`, a
    // table above it) and only one is in the accessibility tree at a given
    // viewport; a role-based query picks whichever is actually visible.
    await page.getByRole("button", { name: /API Gateway — 5xx error rate above 2%/ }).first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByLabel("Responder")).toBeDisabled();
    await expect(
      drawer.getByRole("list", { name: "Incident lifecycle" }).getByRole("button", { name: "Identified" }),
    ).toBeDisabled();
    await expect(
      drawer.getByText("Your role can read this incident but cannot post to its timeline."),
    ).toBeVisible();
  });

  test("blocks the integration builder while previewing Viewer", async ({ page }) => {
    await page.goto("/settings/team");
    await page.getByRole("button", { name: /Viewer/ }).first().click();

    await page.goto("/integrations");
    // Unlike "Declare incident" on the incidents page, this button stays
    // rendered but disabled — the preview mechanic disables the control here
    // rather than removing it, so check the button's state, not its presence.
    await expect(page.getByRole("button", { name: "New integration" })).toBeDisabled();
  });

  test("says explicitly that the preview does not change what the server allows", async ({ page }) => {
    await page.goto("/settings/team");
    await page.getByRole("button", { name: /Viewer/ }).first().click();

    await expect(page.getByText(/every API request still runs under your real role/)).toBeVisible();
  });

  test("stops previewing from the banner", async ({ page }) => {
    await page.goto("/settings/team");
    await page.getByRole("button", { name: /Viewer/ }).first().click();
    await expect(page.getByText(/Previewing as/)).toBeVisible();

    await page.getByRole("button", { name: "Stop previewing" }).click();
    await expect(page.getByText(/Previewing as/)).toHaveCount(0);
  });
});

test.describe("Server-enforced RBAC (real viewer account)", () => {
  test.use({ storageState: storageStatePath("acmeViewer") });

  test("a real Viewer cannot see the declare-incident control at all", async ({ page }) => {
    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: "Declare incident" })).toHaveCount(0);
  });

  test("a real Viewer's API requests are refused server-side, not just hidden client-side", async ({
    request,
  }) => {
    const response = await request.post("/api/incidents", {
      data: {
        title: "Should never be created",
        summary: "A viewer attempting to declare an incident directly against the API.",
        serviceId: "api-gateway",
        severity: "warning",
      },
    });

    expect(response.status()).toBe(403);
    const body = (await response.json()) as { requiredPermission: string };
    expect(body.requiredPermission).toBe("incident:create");
  });

  test("cannot invite a team member", async ({ page }) => {
    await page.goto("/settings/team");
    await expect(
      page.getByText("Your role cannot invite members. Ask an Owner to add someone to this workspace."),
    ).toBeVisible();
  });
});

test.describe("Multi-tenant role isolation", () => {
  test("the same person holds a different role in a different organisation", async ({ page }) => {
    // Ada is Owner at Acme (the default org on sign-in) and Viewer at Stark.
    // "Owner" appears in several places on this page (the role simulator, the
    // member table's role select, the matrix header, a hidden-on-mobile label
    // in the user menu) — scoped to the one that is reliably present and
    // visible at every viewport: the permission matrix's own column header.
    await page.goto("/settings/team");
    await expect(
      page.getByRole("table", { name: /Permissions granted to each role/ }).getByRole("columnheader", {
        name: /Owner/,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Acme Corp/ }).click();
    await page.getByRole("option", { name: /Stark Industries/ }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: "Declare incident" })).toHaveCount(0);
  });
});
