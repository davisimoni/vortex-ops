import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearedSessionCookie,
  decodeSession,
  encodeSession,
  resetEphemeralSessionSecret,
  sessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/session/cookie";

const ORIGINAL_ENV = process.env.VORTEX_ENV;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.VORTEX_ENV;
  else process.env.VORTEX_ENV = ORIGINAL_ENV;
});

describe("session cookie", () => {
  beforeEach(() => {
    resetEphemeralSessionSecret();
  });

  it("round-trips a valid token", () => {
    const now = 1_700_000_000_000;
    const token = encodeSession("usr_ada", "org_acme", now);
    const decoded = decodeSession(token, now + 1_000);

    expect(decoded).toMatchObject({ uid: "usr_ada", oid: "org_acme" });
  });

  it("rejects an expired token", () => {
    const now = 1_700_000_000_000;
    const token = encodeSession("usr_ada", "org_acme", now);

    // 12h max age, plus a margin.
    const decoded = decodeSession(token, now + 13 * 60 * 60_000);
    expect(decoded).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = encodeSession("usr_ada", "org_acme");
    const [payload, signature] = token.split(".");

    // Swap in a different (but validly base64url-encoded) user id.
    const forged = Buffer.from(
      JSON.stringify({ uid: "usr_attacker", oid: "org_acme", iat: 0, exp: 9_999_999_999 }),
      "utf8",
    ).toString("base64url");

    expect(decodeSession(`${forged}.${signature}`)).toBeNull();
    expect(payload).toBeDefined();
  });

  it("rejects a tampered signature", () => {
    const token = encodeSession("usr_ada", "org_acme");
    const [payload] = token.split(".");
    expect(decodeSession(`${payload}.not-a-real-signature`)).toBeNull();
  });

  it("rejects a missing, empty or malformed token", () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession("")).toBeNull();
    expect(decodeSession("no-separator")).toBeNull();
    expect(decodeSession("...")).toBeNull();
  });

  it("rejects a token issued too far in the future beyond clock-skew tolerance", () => {
    const farFuture = Date.now() + 10 * 60_000;
    const token = encodeSession("usr_ada", "org_acme", farFuture);
    expect(decodeSession(token, Date.now())).toBeNull();
  });

  it("tolerates a small amount of clock skew", () => {
    const now = Date.now();
    // 30s ahead — inside the 60s skew tolerance.
    const token = encodeSession("usr_ada", "org_acme", now + 30_000);
    expect(decodeSession(token, now)).not.toBeNull();
  });

  it("two encodings of the same identity are not byte-identical (fresh iat/exp)", () => {
    const a = encodeSession("usr_ada", "org_acme", 1_000);
    const b = encodeSession("usr_ada", "org_acme", 2_000);
    expect(a).not.toBe(b);
  });
});

describe("cookie attributes", () => {
  it("is always httpOnly and same-site lax", () => {
    const cookie = sessionCookie("token-value");
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
  });

  it("is only marked secure in production", () => {
    process.env.VORTEX_ENV = "development";
    expect(sessionCookie("x").secure).toBe(false);

    process.env.VORTEX_ENV = "production";
    expect(sessionCookie("x").secure).toBe(true);
  });

  it("clears with an empty value and zero max-age", () => {
    const cleared = clearedSessionCookie();
    expect(cleared.value).toBe("");
    expect(cleared.maxAge).toBe(0);
  });
});
