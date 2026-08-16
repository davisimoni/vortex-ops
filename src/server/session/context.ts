import { cookies } from "next/headers";

import { effectivePermissions, type Permission } from "@/lib/rbac";
import type { SessionSnapshot } from "@/lib/session";
import { getRepository, getStorageStatus } from "@/server/repository";
import { decodeSession, SESSION_COOKIE_NAME } from "@/server/session/cookie";

/**
 * Server-side session resolution.
 *
 * The cookie is a *claim*: it names a user and a selected organisation. This
 * function turns that claim into authority by looking the membership up on
 * every request. A role revoked a second ago is revoked now — nothing about the
 * user's standing is trusted from the cookie itself.
 */

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  readonly permission: Permission;
  constructor(permission: Permission, message?: string) {
    super(message ?? `Missing permission: ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

/**
 * Resolves the current session, or `null` when there is none.
 *
 * Returns `null` — rather than throwing — for an expired cookie, a user who no
 * longer exists, a membership that was removed, and a membership that is
 * suspended or still pending an invitation. All of them mean the same thing to
 * the caller, and collapsing them also avoids telling an attacker *which* of
 * those states an account is in.
 */
export async function readSession(): Promise<SessionSnapshot | null> {
  const jar = await cookies();
  const payload = decodeSession(jar.get(SESSION_COOKIE_NAME)?.value);
  if (!payload) return null;

  const repository = await getRepository();

  const [user, membership, organization] = await Promise.all([
    repository.findUserById(payload.uid),
    repository.getMembership(payload.uid, payload.oid),
    repository.getOrganization(payload.oid),
  ]);

  if (!user || !membership || !organization) return null;
  // An invited-but-not-accepted or suspended membership is not a session.
  if (membership.status !== "active") return null;

  const [organizations, overrides, storage] = await Promise.all([
    repository.listOrganizationsForUser(user.id),
    repository.listRoleOverrides(organization.id),
    getStorageStatus(),
  ]);

  return {
    user: { id: user.id, name: user.name, email: user.email },
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      environment: organization.environment,
      metricSeed: organization.metricSeed,
    },
    organizations: organizations.map((org) => ({
      id: org.id,
      slug: org.slug,
      name: org.name,
      environment: org.environment,
    })),
    role: membership.role,
    permissions: effectivePermissions(membership.role, overrides),
    storage,
  };
}

export async function requireSession(): Promise<SessionSnapshot> {
  const session = await readSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * The authorisation boundary for every mutating route.
 *
 * Not a convenience wrapper around a UI check: the disabled button is a
 * courtesy to the user, and this is the thing that actually stops the request.
 */
export async function requirePermission(permission: Permission): Promise<SessionSnapshot> {
  const session = await requireSession();
  if (!session.permissions.includes(permission)) throw new ForbiddenError(permission);
  return session;
}

/** Maps a thrown auth error onto a response. Anything else is rethrown. */
export function authErrorResponse(error: unknown): Response | null {
  if (error instanceof UnauthorizedError) {
    return Response.json(
      { error: "unauthorized", message: error.message },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (error instanceof ForbiddenError) {
    return Response.json(
      {
        error: "forbidden",
        message: "Your role in this organisation does not allow that.",
        requiredPermission: error.permission,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  return null;
}
