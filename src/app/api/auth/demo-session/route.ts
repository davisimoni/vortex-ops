import { NextResponse } from "next/server";

import { DEMO_ACCOUNTS } from "@/components/auth/demo-accounts";
import { logger } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getRepository } from "@/server/repository";
import { encodeSession, sessionCookie } from "@/server/session/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every anonymous visitor lands here the same way — one persona, not a lottery. */
const DEMO_ORG_SLUG = "acme-corp";

const PROVISION_LIMIT = 30;
const PROVISION_WINDOW_MS = 60_000;

/**
 * Auto-provisions the portfolio's front door: a real session for the seeded
 * "Owner at Acme Corp" persona, with no credentials typed anywhere.
 *
 * `(app)/layout.tsx` redirects here — instead of `/sign-in` — whenever a
 * request arrives with no valid session cookie, so a first-time visitor lands
 * directly on the real dashboard. This is a `GET` route handler rather than
 * logic inlined in the layout because Next.js refuses to let a Server
 * Component mutate cookies mid-render; a route handler is the one place
 * allowed to. It is *not* a second, weaker authentication path — it signs the
 * cookie with the exact same `encodeSession`/`sessionCookie` helpers
 * `/api/auth/sign-in` uses, pre-filled with a fixed identity instead of a
 * submitted password. Every write that identity makes afterwards is a real
 * write, permission-checked and audited exactly like a password sign-in.
 *
 * Explicit sign-in still exists for anyone who wants a specific role instead
 * — "Switch account" in the user menu clears this cookie and lands on the
 * real picker (`src/components/layout/user-menu.tsx`).
 */
export async function GET(request: Request): Promise<Response> {
  const limit = rateLimit(`demo-session:${clientKey(request)}`, PROVISION_LIMIT, PROVISION_WINDOW_MS);
  if (!limit.allowed) {
    // An ordinary visitor never gets near this limit — only a script hitting
    // the endpoint directly, never sending the cookie back, would. There is
    // still a legitimate way in, so send them to it rather than an error page.
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const guest = DEMO_ACCOUNTS[0];
  const repository = await getRepository();
  const user = guest ? await repository.findUserByEmail(guest.email) : null;

  if (!user) {
    // The seed never ran, or the fixture email changed under this route —
    // fail out to the real sign-in page rather than looping the visitor back
    // into a gate that can never pass.
    logger.error("Could not resolve the default demo persona for auto-provisioning", {
      email: guest?.email ?? "unknown",
    });
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const organizations = await repository.listOrganizationsForUser(user.id);
  const organization = organizations.find((org) => org.slug === DEMO_ORG_SLUG) ?? organizations[0];

  if (!organization) {
    logger.error("Demo persona has no organisation membership", { userId: user.id });
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set(sessionCookie(encodeSession(user.id, organization.id)));

  await repository.touchMembership(user.id, organization.id, Date.now());
  await repository.appendAudit({
    orgId: organization.id,
    actorId: user.id,
    actorName: user.name,
    action: "auth.demo_session",
    targetType: "session",
    targetId: null,
    outcome: "success",
    // The audit trail is meant to answer "who did what" honestly — a row
    // indistinguishable from a real password sign-in would misrepresent how
    // this session actually started.
    metadata: { organization: organization.slug, auto: true },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  logger.info("Auto-provisioned demo session", { userId: user.id, orgId: organization.id });

  return response;
}
