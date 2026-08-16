import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.describe("Live log viewer", () => {
  test.use({ storageState: storageStatePath("acmeOwner") });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/logs");
  });

  test("streams lines into the terminal", async ({ page }) => {
    const terminal = page.getByRole("log", { name: "Live application logs" });
    await expect(terminal).toBeVisible();

    // The server logs its own startup and every request it serves — this page
    // load alone is enough to produce at least one line within a few seconds.
    await expect(async () => {
      expect(await terminal.innerText()).not.toContain("Waiting for log lines");
    }).toPass({ timeout: 15_000 });
  });

  test("offers level filters, search, pause/resume and export", async ({ page }) => {
    await expect(page.getByRole("button", { name: "info", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "warn", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "error", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search logs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export logs" })).toBeVisible();
  });

  test("toggling a level chip off hides matching lines, and the last one cannot be turned off", async ({
    page,
  }) => {
    const terminal = page.getByRole("log", { name: "Live application logs" });
    await expect(async () => {
      expect(await terminal.innerText()).not.toContain("Waiting for log lines");
    }).toPass({ timeout: 15_000 });

    const infoChip = page.getByRole("button", { name: "info", exact: true });
    const warnChip = page.getByRole("button", { name: "warn", exact: true });
    const errorChip = page.getByRole("button", { name: "error", exact: true });

    // Turn off warn and error, leaving only info — this app logs at "info" for
    // routine activity, so this should not empty the terminal.
    await warnChip.click();
    await errorChip.click();
    await expect(infoChip).toHaveAttribute("aria-pressed", "true");
    await expect(warnChip).toHaveAttribute("aria-pressed", "false");

    // With only "info" left on, turning it off too must be a no-op: an empty
    // terminal with no visible cause reads as broken, not as "filtered out".
    await infoChip.click();
    await expect(infoChip).toHaveAttribute("aria-pressed", "true");
  });

  test("pauses and resumes the stream", async ({ page }) => {
    const pause = page.getByRole("button", { name: "Pause stream" });
    await pause.click();

    const resume = page.getByRole("button", { name: "Resume stream" });
    await expect(resume).toHaveAttribute("aria-pressed", "true");

    await resume.click();
    await expect(page.getByRole("button", { name: "Pause stream" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("narrows the terminal to a search term", async ({ page }) => {
    const terminal = page.getByRole("log", { name: "Live application logs" });
    await expect(async () => {
      expect(await terminal.innerText()).not.toContain("Waiting for log lines");
    }).toPass({ timeout: 15_000 });

    await page.getByRole("searchbox", { name: "Search logs" }).fill("zzz-no-such-line-in-any-log");
    await expect(page.getByText("No lines match the current filters.")).toBeVisible();
  });
});

test.describe("Live log viewer — permissions", () => {
  test.use({ storageState: storageStatePath("acmeViewer") });

  test("is blocked server-side for a role without logs:read, before any stream opens", async ({ page }) => {
    // The check runs in the page component, not only in the client — see the
    // comment in `app/(app)/dashboard/logs/page.tsx` on why: `EventSource`
    // cannot see a 403, so gating only in the browser would leave a denied
    // role's tab open in an infinite reconnect loop against the stream route.
    await page.goto("/dashboard/logs");
    await expect(page.getByText("You don't have access to the log viewer.")).toBeVisible();
    await expect(page.getByRole("log", { name: "Live application logs" })).toHaveCount(0);
  });
});
