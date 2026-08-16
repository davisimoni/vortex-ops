import { NextResponse } from "next/server";

import { DEMO_ACCOUNTS } from "@/components/auth/demo-accounts";
import { logger } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { isProductionDeployment } from "@/lib/runtime-env";
import { getRepository } from "@/server/repository";
import { encodeSession, sessionCookie } from "@/server/session/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every anonymous visitor lands here the same way — one persona, not a lottery. */
const DEMO_ORG_SLUG = "acme-corp";

const PROVISION_LIMIT = 30;
const PROVISION_WINDOW_MS = 60_000;

/**
 * Breadcrumb, not a session. Its only job is to answer one question on the
 * *next* request: "did this route already run for this visitor a moment ago?"
 *
 * That distinguishes the two reasons `(app)/layout.tsx` can land here twice:
 * an ordinary, naturally expired session hours or days later (this cookie
 * will have long since expired too — proceed normally, issue a fresh one), or
 * the session issued moments ago failing to verify on the very next request
 * (this cookie is still fresh — something is fundamentally broken, e.g. an
 * ephemeral signing secret that is not stable across server instances, most
 * often because VORTEX_SESSION_SECRET was never set on a multi-instance
 * platform). Only the second case needs breaking out of.
 */
const ATTEMPT_COOKIE = "vortex_demo_attempt";
const ATTEMPT_WINDOW_SECONDS = 20;

function toSignIn(request: Request, reason: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/sign-in?reason=${reason}`, request.url));
  response.cookies.delete(ATTEMPT_COOKIE);
  return response;
}

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
 *
 * Every exit from this handler is a redirect, never a thrown 500 and never a
 * second pass through provisioning — see `ATTEMPT_COOKIE` above and the
 * `catch` below. A visitor should never see a raw error page, and this route
 * should never be the thing that turns a misconfiguration into
 * `ERR_TOO_MANY_REDIRECTS`.
 */
export async function GET(request: Request): Promise<Response> {
  const limit = rateLimit(`demo-session:${clientKey(request)}`, PROVISION_LIMIT, PROVISION_WINDOW_MS);
  if (!limit.allowed) {
    // An ordinary visitor never gets near this limit — only a script hitting
    // the endpoint directly, never sending the cookie back, would. There is
    // still a legitimate way in, so send them to it rather than an error page.
    return toSignIn(request, "rate_limited");
  }

  if (request.headers.get("cookie")?.includes(`${ATTEMPT_COOKIE}=1`)) {
    logger.error(
      "A demo session issued moments ago did not verify on the very next request — breaking " +
        "the retry loop instead of provisioning another one.",
      {
        hint: "Check that VORTEX_SESSION_SECRET is set to the same value on every server instance.",
        isProductionDeployment: isProductionDeployment(),
      },
    );
    return toSignIn(request, "session_unstable");
  }

  try {
    const guest = DEMO_ACCOUNTS[0];
    const repository = await getRepository();
    const user = guest ? await repository.findUserByEmail(guest.email) : null;

    if (!user) {
      // The seed never ran, or the fixture email changed under this route —
      // fail out to the real sign-in page rather than looping the visitor
      // back into a gate that can never pass.
      logger.error("Could not resolve the default demo persona for auto-provisioning", {
        email: guest?.email ?? "unknown",
      });
      return toSignIn(request, "no_demo_account");
    }

    const organizations = await repository.listOrganizationsForUser(user.id);
    const organization = organizations.find((org) => org.slug === DEMO_ORG_SLUG) ?? organizations[0];

    if (!organization) {
      logger.error("Demo persona has no organisation membership", { userId: user.id });
      return toSignIn(request, "no_demo_account");
    }

    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    response.cookies.set(sessionCookie(encodeSession(user.id, organization.id)));
    response.cookies.set({
      name: ATTEMPT_COOKIE,
      value: "1",
      httpOnly: true,
      sameSite: "lax",
      secure: isProductionDeployment(),
      path: "/",
      maxAge: ATTEMPT_WINDOW_SECONDS,
    });

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
  } catch (error) {
    // encodeSession() throws when VORTEX_SESSION_SECRET is missing on a real
    // deployment (see isProductionDeployment() in lib/runtime-env.ts) — that
    // is the correct, loud failure for a broken signing setup, but a raw 500
    // here would still be a worse landing than a working sign-in page with
    // the demo accounts listed on it.
    logger.exception("Demo session provisioning failed", error);
    return toSignIn(request, "provisioning_failed");
  }
}
