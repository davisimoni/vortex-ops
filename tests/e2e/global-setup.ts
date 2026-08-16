import { mkdirSync } from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { ACCOUNTS, DEMO_PASSWORD } from "./accounts";

export const STORAGE_DIR = path.join(__dirname, ".auth");

/**
 * Signs in every demo account once, before any spec runs, and saves each
 * session as a Playwright storage state file.
 *
 * The app is now genuinely auth-gated — every page redirects to `/sign-in`
 * without a valid session cookie. Repeating the sign-in form flow (navigate,
 * fill two fields, submit, wait for redirect) at the top of every single test
 * would triple the suite's runtime for no additional coverage; the sign-in
 * *flow itself* is covered once, explicitly, in `auth.spec.ts`. Every other
 * spec starts already authenticated via `test.use({ storageState })`.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  mkdirSync(STORAGE_DIR, { recursive: true });

  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("global-setup: no baseURL configured on the Playwright project.");

  const context = await request.newContext({ baseURL });

  let syntheticIp = 1;
  for (const [key, account] of Object.entries(ACCOUNTS)) {
    // `/api/auth/sign-in` is rate-limited per client IP (credential-stuffing
    // defence). Locally there is no reverse proxy setting a real
    // `x-forwarded-for`, so every request — this loop's four sign-ins, plus
    // whatever auth.spec.ts does afterwards — would otherwise collapse into
    // one shared "anonymous" bucket and exhaust it before the suite even
    // starts. A distinct synthetic IP per account keeps each its own budget,
    // the way a real deployment behind a proxy would separate real clients.
    const response = await context.post("/api/auth/sign-in", {
      headers: { "x-forwarded-for": `10.0.0.${syntheticIp++}` },
      data: { email: account.email, password: DEMO_PASSWORD },
    });

    if (!response.ok()) {
      throw new Error(
        `global-setup: sign-in failed for ${account.email} (${response.status()}): ${await response.text()}`,
      );
    }

    await context.storageState({ path: storageStatePath(key) });
  }

  await context.dispose();
}

export function storageStatePath(key: string): string {
  return path.join(STORAGE_DIR, `${key}.json`);
}
