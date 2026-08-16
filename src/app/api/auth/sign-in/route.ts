import { cookies } from "next/headers";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { verifyPassword } from "@/server/crypto/password";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { encodeSession, sessionCookie } from "@/server/session/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(512),
  /** Optional: sign straight into a specific tenant. Defaults to the first. */
  organizationId: z.string().max(64).optional(),
});

/** Five attempts per minute per client. Credential stuffing is the threat. */
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 60_000;

/**
 * Password sign-in.
 *
 * Three properties worth naming:
 *
 *  - **One error message.** Unknown address, wrong password and an account with
 *    no password set all return the same 401. Distinguishing them turns the
 *    endpoint into an account-enumeration oracle.
 *  - **Constant-ish work.** A miss still runs a scrypt verification against a
 *    dummy hash, so response time does not reveal whether the address exists.
 *  - **Rate limited before anything else.** scrypt is deliberately expensive;
 *    without a limiter in front, the sign-in route is a CPU exhaustion vector.
 */
export const POST = route("/api/auth/sign-in", async (request) => {
  const limit = rateLimit(`sign-in:${clientKey(request)}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);
  if (!limit.allowed) {
    return jsonError(
      "rate_limited",
      `Too many sign-in attempts. Try again in ${limit.retryAfter}s.`,
      429,
      { retryAfter: limit.retryAfter },
    );
  }

  const body = await readJsonBody(request, schema);
  if (!body.ok) return body.response;

  const repository = await getRepository();
  const user = await repository.findUserByEmail(body.data.email);

  // A dummy hash with the same parameters as a real one, so a miss costs the
  // same as a hit.
  const DUMMY_HASH =
    "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  const valid = await verifyPassword(
    body.data.password,
    user && user.passwordHash.length > 0 ? user.passwordHash : DUMMY_HASH,
  );

  if (!user || !valid) {
    logger.warn("Sign-in rejected", { emailDomain: body.data.email.split("@")[1] ?? "unknown" });
    return jsonError("invalid_credentials", "That email and password do not match an account.", 401);
  }

  const organizations = await repository.listOrganizationsForUser(user.id);
  if (organizations.length === 0) {
    return jsonError(
      "no_organization",
      "This account is not an active member of any organisation. Ask an owner to re-invite you.",
      403,
    );
  }

  const requested = body.data.organizationId
    ? organizations.find((org) => org.id === body.data.organizationId)
    : undefined;
  const organization = requested ?? organizations[0];
  if (!organization) {
    return jsonError("no_organization", "No organisation available for this account.", 403);
  }

  const jar = await cookies();
  jar.set(sessionCookie(encodeSession(user.id, organization.id)));

  await repository.touchMembership(user.id, organization.id, Date.now());
  await repository.appendAudit({
    orgId: organization.id,
    actorId: user.id,
    actorName: user.name,
    action: "auth.sign_in",
    targetType: "session",
    targetId: null,
    outcome: "success",
    metadata: { organization: organization.slug },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  logger.info("Sign-in accepted", { userId: user.id, orgId: organization.id });

  return jsonOk({
    user: { id: user.id, name: user.name, email: user.email },
    organization: { id: organization.id, slug: organization.slug, name: organization.name },
  });
});
