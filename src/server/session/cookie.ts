import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";
import { isProductionDeployment } from "@/lib/runtime-env";

/**
 * Stateless session cookie.
 *
 * `<payload base64url>.<hmac base64url>` — the payload is readable, the
 * signature is what makes it trustworthy. There is no session table: the cookie
 * carries the user and the *currently selected organisation*, and both are
 * re-checked against the database on every request. The cookie says who you
 * claim to be; the membership lookup decides what that is worth. A cookie that
 * carried the role itself would keep granting Owner after a demotion, until it
 * expired.
 *
 * Not a JWT. A JWT here would mean a header nobody reads, an algorithm field
 * that has to be pinned to avoid `alg: none`, and a dependency — for a signed
 * blob that never leaves our own origin.
 */

const COOKIE_NAME = "vortex_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;
/** Clock skew tolerance for `iat`, so a slightly fast client is not rejected. */
const SKEW_SECONDS = 60;

export interface SessionPayload {
  /** User id. */
  readonly uid: string;
  /** Selected organisation id. */
  readonly oid: string;
  /** Issued at, epoch seconds. */
  readonly iat: number;
  /** Expires at, epoch seconds. */
  readonly exp: number;
}

let ephemeralSecret: string | null = null;

/**
 * Resolves the signing secret.
 *
 * In production a missing secret is fatal: an ephemeral one would silently
 * invalidate every session on each deploy and, across several instances, on
 * every other request. In development it is generated once per process with a
 * warning, so `npm run dev` works with an empty `.env`.
 */
function secret(): string {
  const configured = process.env.VORTEX_SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

  if (isProductionDeployment()) {
    throw new Error(
      "VORTEX_SESSION_SECRET must be set to at least 32 characters in production. " +
        "Generate one with: openssl rand -base64 48",
    );
  }

  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(48).toString("base64url");
    logger.warn("No VORTEX_SESSION_SECRET set — using an ephemeral development secret", {
      consequence: "Sessions are invalidated when the server restarts.",
    });
  }
  return ephemeralSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(uid: string, oid: string, now: number = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    uid,
    oid,
    iat: issuedAt,
    exp: issuedAt + MAX_AGE_SECONDS,
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Verifies and decodes. Returns `null` for anything that is not a valid,
 * unexpired, correctly signed token — never throws, because every failure mode
 * here means the same thing to the caller: not signed in.
 */
export function decodeSession(token: string | undefined, now: number = Date.now()): SessionPayload | null {
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const encoded = token.slice(0, separator);
  const provided = token.slice(separator + 1);

  let expected: string;
  try {
    expected = sign(encoded);
  } catch {
    // Missing secret in production — treat every session as invalid rather
    // than accepting unverifiable ones.
    return null;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.uid !== "string" ||
      typeof candidate.oid !== "string" ||
      typeof candidate.iat !== "number" ||
      typeof candidate.exp !== "number"
    ) {
      return null;
    }

    const nowSeconds = Math.floor(now / 1000);
    if (candidate.exp <= nowSeconds) return null;
    if (candidate.iat > nowSeconds + SKEW_SECONDS) return null;

    return { uid: candidate.uid, oid: candidate.oid, iat: candidate.iat, exp: candidate.exp };
  } catch {
    return null;
  }
}

export interface CookieAttributes {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

/**
 * Cookie attributes.
 *
 * `httpOnly` so script cannot read it — an XSS then cannot exfiltrate the
 * session. `sameSite: "lax"` because every state change here is a POST from our
 * own origin, and lax blocks the cross-site POST that CSRF depends on while
 * still surviving an ordinary inbound link. `secure` in production only, so
 * local http development still works.
 */
export function sessionCookie(value: string, maxAge: number = MAX_AGE_SECONDS): CookieAttributes {
  return {
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: isProductionDeployment(),
    path: "/",
    maxAge,
  };
}

export function clearedSessionCookie(): CookieAttributes {
  return sessionCookie("", 0);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS;

/** Test seam — the development secret is memoised per process. */
export function resetEphemeralSessionSecret(): void {
  ephemeralSecret = null;
}
