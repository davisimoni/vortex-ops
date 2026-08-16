import { describe, expect, it } from "vitest";

import { hashPassword, needsRehash, verifyPassword } from "@/server/crypto/password";

describe("password hashing", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("is case-sensitive", async () => {
    const hash = await hashPassword("Password1");
    expect(await verifyPassword("password1", hash)).toBe(false);
  });

  it("produces a different hash for the same password each time (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("stores its own cost parameters in the hash", async () => {
    const hash = await hashPassword("x");
    const [scheme, n, r, p] = hash.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThan(0);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("treats a malformed stored hash as a mismatch, not a crash", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$bad$data")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("refuses a stored hash demanding unreasonable cost parameters", async () => {
    // A malicious or corrupted row must not be able to make verification hang
    // or exhaust memory.
    const hostile = `scrypt$${2 ** 22}$8$1$${"A".repeat(22)}$${"A".repeat(86)}`;
    await expect(verifyPassword("anything", hostile)).resolves.toBe(false);
  });

  it("flags an empty hash (invited-but-not-registered account) for rehash, not for accidental login", async () => {
    expect(needsRehash("")).toBe(true);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("does not flag a freshly hashed password as needing a rehash", async () => {
    const hash = await hashPassword("x");
    expect(needsRehash(hash)).toBe(false);
  });

  it("flags a hash produced with weaker-than-current parameters", () => {
    const weak = `scrypt$${2 ** 10}$8$1$${"A".repeat(22)}$${"A".repeat(86)}`;
    expect(needsRehash(weak)).toBe(true);
  });
});
