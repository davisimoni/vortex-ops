import { expect, test, type Page } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.use({ storageState: storageStatePath("acmeOwner") });

/**
 * A name unique to this test, this project and this run.
 *
 * Chromium and mobile-safari share one server process for the whole suite
 * invocation (see the isolation note in playwright.config.ts) — chromium's
 * pass through this file runs first and leaves its integrations in the
 * store, uncleaned. A fixed literal name like "E2E Telegram bot" reused in
 * mobile-safari's pass collides with chromium's own leftover of the same
 * name, and every locator keyed on that heading becomes ambiguous. A name
 * salted with the project and a timestamp cannot collide with anything else
 * in the suite, this run or a previous one.
 */
function uniqueName(label: string): string {
  return `E2E ${label} ${test.info().project.name} ${Date.now()}`;
}

/**
 * Scopes to exactly one integration card by its heading.
 *
 * `page.locator("div", { has: heading }).first()` looks scoped but is not:
 * *every* ancestor `<div>` of the heading — the Card root, the grid wrapper
 * around every card, the page's outer flex container — independently
 * satisfies "a div containing this heading", and `.first()` resolves to
 * whichever opens earliest in the HTML source, which is the outermost
 * wrapper, not the card. `IntegrationCard` renders via `<Card>`, whose own
 * base class always includes `rounded-xl`; none of those outer wrappers do,
 * and no card nests inside another, so this selector is unambiguous.
 */
function integrationCard(page: Page, heading: string) {
  return page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: heading, exact: true }) });
}

/**
 * Scopes to the webhook builder form itself — "New integration" or an "Edit"
 * in progress.
 *
 * This is not just tidiness: integrations created by earlier tests in this
 * file are never cleaned up (the shared in-memory store persists for the
 * whole suite run), so by the time a later test opens the builder, the page
 * already has other cards on it with their own labelled controls. One of
 * those collided for real — a leftover card named "…(renamed)" has a switch
 * labelled "Disable … (renamed)", and `getByLabel("Name")` matched it too,
 * because Playwright's label matching is a case-insensitive *substring*
 * match and "renamed" contains "name". Scoping every field lookup to the
 * builder card — the only card with a "Create integration"/"Save changes"
 * submit button — makes that collision structurally impossible rather than
 * hoping no other card ever contains "name" as a substring.
 */
function builder(page: Page) {
  return page.locator("div.rounded-xl", {
    has: page.getByRole("button", { name: /Create integration|Save changes/ }),
  });
}

test.describe("Integration & webhook builder", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/integrations");
  });

  test("lists Acme's seeded destinations", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "#incidents" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Platform primary rotation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status page sync" })).toBeVisible();
  });

  test("previews the exact payload the server will send, marked as a test", async ({ page }) => {
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);

    const preview = form.locator("pre");
    await expect(preview).toContainText('"type": "incident.opened"');
    // A test send must be unmistakable, or somebody gets paged over a button click.
    await expect(preview).toContainText("TEST");
  });

  test("switches the payload dialect and required fields with the destination", async ({ page }) => {
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);

    await form.getByLabel("Destination").selectOption("pagerduty");
    await expect(form.locator("pre")).toContainText('"routing_key"');
    await expect(form.getByLabel("Routing key")).toBeVisible();

    await form.getByLabel("Destination").selectOption("discord");
    await expect(form.locator("pre")).toContainText('"embeds"');
    await expect(form.getByLabel("Endpoint URL")).toBeVisible();

    await form.getByLabel("Destination").selectOption("telegram");
    await expect(form.locator("pre")).toContainText('"chat_id"');
    // Telegram's real endpoint is derived from the bot token server-side —
    // there is nothing for the operator to type as a URL.
    await expect(form.getByLabel("Endpoint URL")).toHaveCount(0);
    await expect(form.getByLabel("Bot token")).toBeVisible();
    await expect(form.getByLabel("Chat ID")).toBeVisible();
  });

  test("refuses a private destination before anything is saved", async ({ page }) => {
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);

    await form.getByLabel("Name").fill(uniqueName("Metadata probe"));
    await form.getByLabel("Endpoint URL").fill("https://169.254.169.254/latest/meta-data/");
    await form.getByRole("button", { name: "Create integration" }).click();

    await expect(
      page.getByText("Private, loopback and link-local addresses cannot receive webhooks."),
    ).toBeVisible();
  });

  test("enforces the provider host allowlist", async ({ page }) => {
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);

    await form.getByLabel("Destination").selectOption("slack");
    await form.getByLabel("Name").fill(uniqueName("Fake Slack"));
    await form.getByLabel("Endpoint URL").fill("https://hooks.slack.com.attacker.test/x");
    await form.getByRole("button", { name: "Create integration" }).click();

    await expect(page.getByText(/only accepts endpoints on/)).toBeVisible();
  });

  test("creates a Discord integration from just a webhook URL — no separate credential", async ({
    page,
  }) => {
    const name = uniqueName("Discord channel");
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);
    await form.getByLabel("Destination").selectOption("discord");

    await form.getByLabel("Name").fill(name);
    await form
      .getByLabel("Endpoint URL")
      .fill("https://discord.com/api/webhooks/123456789012345678/e2e-test-token");
    await form.getByRole("button", { name: "Create integration" }).click();

    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  });

  test("creates a Telegram integration requiring a bot token and chat id", async ({ page }) => {
    const name = uniqueName("Telegram bot");
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);
    await form.getByLabel("Destination").selectOption("telegram");

    await form.getByLabel("Name").fill(name);
    await form.getByRole("button", { name: "Create integration" }).click();
    // Neither credential field has been filled in yet.
    await expect(form.getByText(/needs a/)).toBeVisible();

    await form.getByLabel("Bot token").fill("123456789:E2E-fake-bot-token");
    await form.getByLabel("Chat ID").fill("-1001234567890");
    await form.getByRole("button", { name: "Create integration" }).click();

    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    // The credential hint proves something was stored, without showing it.
    const card = integrationCard(page, name);
    await expect(card.getByText("••••", { exact: false }).first()).toBeVisible();
  });

  test("flags a provider whose payload shape is not a confirmed contract", async ({ page }) => {
    const name = uniqueName("email digest");
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);
    await form.getByLabel("Destination").selectOption("email");

    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Endpoint URL").fill("https://relay.example.com/v1/send");
    await form.getByLabel("Relay API key").fill("e2e-relay-key");
    await form.getByLabel("Recipients").fill("oncall@example.com");
    await form.getByRole("button", { name: "Create integration" }).click();

    const card = integrationCard(page, name);
    await expect(card.getByText("Unverified payload shape")).toBeVisible();
  });

  test("sends a real notification through a saved integration and reports a real failure honestly", async ({
    page,
  }) => {
    const name = uniqueName("doomed webhook");
    await page.getByRole("button", { name: "New integration" }).click();
    const form = builder(page);
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Endpoint URL").fill("https://e2e-does-not-resolve.vortex-ops.invalid/hook");
    await form.getByRole("button", { name: "Create integration" }).click();

    const card = integrationCard(page, name);
    await card.getByRole("button", { name: "Send test payload" }).click();

    // A DNS failure against a domain that cannot exist is fast and
    // deterministic — no real external service in the loop, no flakiness.
    await expect(page.getByText(/Notification (delivered|not delivered)/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(card.getByText(/Failed/)).toBeVisible();
  });

  test("edit does not clear a stored credential when the field is left blank", async ({ page }) => {
    const name = uniqueName("PD route");
    const renamedTo = `${name} (renamed)`;

    await page.getByRole("button", { name: "New integration" }).click();
    const createForm = builder(page);
    await createForm.getByLabel("Destination").selectOption("pagerduty");
    await createForm.getByLabel("Name").fill(name);
    await createForm.getByLabel("Endpoint URL").fill("https://events.eu.pagerduty.com/v2/enqueue");
    await createForm.getByLabel("Routing key").fill("R0E2EORIGINALKEY");
    await createForm.getByRole("button", { name: "Create integration" }).click();

    const card = integrationCard(page, name);
    const hintBefore = await card.getByText("••••", { exact: false }).first().innerText();

    await card.getByRole("button", { name: "Edit" }).click();
    const editForm = builder(page);
    await editForm.getByLabel("Name").fill(renamedTo);
    // Routing key field left blank on purpose.
    await editForm.getByRole("button", { name: "Save changes" }).click();

    const renamed = integrationCard(page, renamedTo);
    await expect(renamed.getByText(hintBefore)).toBeVisible();
  });
});
