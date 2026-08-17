import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

/** Declares a fresh incident and leaves its drawer open, mirroring incidents.spec.ts's own helper. */
async function declareTestIncident(page: import("@playwright/test").Page): Promise<string> {
  const title = `RCA probe ${test.info().project.name} ${Date.now()}`;

  await page.goto("/incidents");
  await page.getByRole("button", { name: "Declare incident" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Summary").fill("Created by the Playwright suite to exercise the RCA card.");
  await page.getByRole("button", { name: "Declare incident" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  return title;
}

test.describe("AI Root Cause Summary", () => {
  test("shows a headline, an explanation and exactly two remediation commands", async ({ page }) => {
    await declareTestIncident(page);

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("AI Root Cause Summary")).toBeVisible();
    await expect(dialog.getByText(/% confidence/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Copy Fix Command" })).toHaveCount(2);
  });

  test("gives a different analysis for incidents on different services", async ({ page }) => {
    // The seeded incidents span several services — open two directly and
    // compare the whole RCA block, rather than declaring two more (declaring
    // only offers one service picker at a time in this flow).
    await page.goto("/incidents");

    const rcaSection = page.getByRole("dialog").locator("section").filter({ hasText: "AI Root Cause Summary" });

    await page.getByRole("button", { name: /API Gateway.*5xx error rate/ }).first().click();
    const gatewayAnalysis = await rcaSection.innerText();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Postgres Primary.*CPU saturation/ }).first().click();
    const dbAnalysis = await rcaSection.innerText();

    expect(gatewayAnalysis).not.toBe(dbAnalysis);
  });

  test("copying a command flips its button to a confirmed state", async ({ page, context, browserName }) => {
    test.skip(
      browserName === "webkit",
      "WebKit's Playwright driver has no clipboard-write permission to grant — grantPermissions throws outright.",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await declareTestIncident(page);

    const button = page.getByRole("dialog").getByRole("button", { name: "Copy Fix Command" }).first();
    await button.click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Copied" }).first()).toBeVisible();
  });
});
