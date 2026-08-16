import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, DEMO_PASSWORD } from "./accounts";

// Deliberately unauthenticated — this file tests the gate itself, so it must
// not inherit any signed-in storage state from another spec.
test.use({ storageState: { cookies: [], origins: [] } });

/*
 * `/api/auth/sign-in` is rate-limited per client IP. Locally, with no reverse
 * proxy in front of the dev/E2E server, every browser-driven sign-in in this
 * file would otherwise share one "anonymous" bucket with global-setup's own
 * four sign-ins — exhausting the 5-per-minute budget after this file's very
 * first test. Each test gets its own synthetic IP, the way distinct real
 * users behind a real proxy would.
 */
let syntheticIp = 100;
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.0.1.${syntheticIp++}` });
});

/**
 * Navigates to the sign-in page and waits past initial hydration.
 *
 * `page.goto()` only waits for the `load` event — the initial server-rendered
 * HTML, not React attaching its event handlers. Interacting with the form
 * before that finishes is a real race, and a controlled input makes it worse
 * than usual: filling the DOM value before React hydrates sets it correctly
 * for a moment, then hydration reconciles the input against React's still-
 * empty `useState`, which *wipes it back to empty*. `toHaveValue` right after
 * `fill()` can observe the correct value and pass before that reset ever
 * happens. Mobile WebKit, running under heavier CPU throttling in device
 * emulation, hit this consistently; desktop Chromium's faster hydration
 * mostly won the race by luck. Waiting for network idle — everything the
 * page requested, including the JS bundle, has arrived — is what actually
 * closes the window, not a longer timeout on the value check.
 */
async function gotoSignIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
}

/**
 * Fills the sign-in form and submits it.
 *
 * Each field is verified with `toHaveValue` immediately after `fill()` as a
 * second guard: real, beyond the hydration race above, since a fresh
 * assertion right before the click catches any other transient state reset
 * rather than trusting a fill-and-forget.
 */
async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  const emailField = page.getByLabel("Email");
  await emailField.fill(email);
  await expect(emailField).toHaveValue(email);

  const passwordField = page.getByLabel("Password");
  await passwordField.fill(password);
  await expect(passwordField).toHaveValue(password);

  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("Automatic demo session — no sign-in wall", () => {
  test("lands an anonymous visitor straight on the dashboard, auto-signed in as the demo Owner", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    // Ada Okafor, Owner @ Acme Corp — the seeded default persona, not a
    // generic "guest" placeholder identity.
    await expect(page.getByRole("button", { name: /Ada Okafor/ })).toBeVisible();
  });

  test("the root also lands on the dashboard with no session required", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a deep link also provisions the session, even though it still lands on the dashboard first", async ({
    page,
  }) => {
    // "Land directly on the dashboard" is the explicit requirement — a first,
    // cookie-less visit always surfaces there, never at whatever deeper page
    // was originally requested. What this proves is that the provisioning
    // step underneath still ran: a second navigation, now with the cookie
    // already set, reaches the deeper page normally.
    await page.goto("/integrations");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/integrations");
    await expect(page).toHaveURL(/\/integrations$/);
  });

  test("the auto-provisioned session is real, not a read-only shell — it grants Owner permissions", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.goto("/integrations");
    await expect(page.getByRole("button", { name: "New integration" })).toBeEnabled();
  });

  test("survives a reload, the same way a real sign-in would", async ({ page }) => {
    await page.goto("/dashboard");
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: /Ada Okafor/ })).toBeVisible();
  });
});

test.describe("Authentication gate", () => {
  test("refuses API access with 401, not a redirect", async ({ request }) => {
    // An API route cannot redirect a fetch call usefully; it has to answer
    // with a status the caller can branch on.
    const response = await request.get("/api/incidents");
    expect(response.status()).toBe(401);
  });

  test("signs in with a valid demo account and reaches the dashboard", async ({ page }) => {
    await gotoSignIn(page);
    await submitSignIn(page, ACCOUNTS.acmeOwner.email, DEMO_PASSWORD);

    await expect(page).toHaveURL(/\/dashboard$/);
    // The user menu's name/role text is visually hidden below `md`; the
    // button's aria-label carries the name at every viewport instead (see
    // src/components/layout/user-menu.tsx).
    await expect(page.getByRole("button", { name: new RegExp(ACCOUNTS.acmeOwner.name) })).toBeVisible();
  });

  test("rejects the wrong password with one generic message", async ({ page }) => {
    await gotoSignIn(page);
    await submitSignIn(page, ACCOUNTS.acmeOwner.email, "definitely-not-the-password");

    // The same message a nonexistent account gets — this endpoint must not be
    // usable to enumerate which addresses have accounts.
    await expect(page.getByText("That email and password do not match an account.")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("rejects an unknown email with the identical message", async ({ page }) => {
    await gotoSignIn(page);
    await submitSignIn(page, "nobody@vortex-ops.example", DEMO_PASSWORD);

    await expect(page.getByText("That email and password do not match an account.")).toBeVisible();
  });

  test("fills the email field from a demo account shortcut", async ({ page }) => {
    await gotoSignIn(page);
    await page.getByRole("button", { name: new RegExp(ACCOUNTS.acmeViewer.name) }).click();
    await expect(page.getByLabel("Email")).toHaveValue(ACCOUNTS.acmeViewer.email);
  });
});

test.describe("Switch account", () => {
  test("clears an explicit session and lands on the real sign-in picker", async ({ page }) => {
    await gotoSignIn(page);
    await submitSignIn(page, ACCOUNTS.acmeOwner.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: ACCOUNTS.acmeOwner.name }).click();
    await page.getByRole("menuitem", { name: "Switch account" }).click();

    // /sign-in only stays reachable because the cookie was just cleared —
    // with a session present it redirects straight back to the dashboard.
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("a cleared session re-provisions the demo guest on the next dashboard visit, not a sign-in wall", async ({
    page,
  }) => {
    await gotoSignIn(page);
    await submitSignIn(page, ACCOUNTS.acmeOwner.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: ACCOUNTS.acmeOwner.name }).click();
    await page.getByRole("menuitem", { name: "Switch account" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: /Ada Okafor/ })).toBeVisible();
  });
});
