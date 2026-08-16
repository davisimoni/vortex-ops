import { beforeEach, describe, expect, it } from "vitest";

import {
  CryptoUnavailableError,
  decryptSecret,
  encryptSecret,
  isEncryptionAvailable,
  maskCredential,
  resetEncryptionKeyCache,
} from "@/server/crypto/secrets";

const ORIGINAL_ENCRYPTION_KEY = process.env.VORTEX_ENCRYPTION_KEY;
const ORIGINAL_SESSION_SECRET = process.env.VORTEX_SESSION_SECRET;

/** `process.env.X = undefined` coerces to the string "undefined" — delete instead. */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("credential envelope encryption", () => {
  beforeEach(() => {
    restoreEnv("VORTEX_ENCRYPTION_KEY", ORIGINAL_ENCRYPTION_KEY);
    restoreEnv("VORTEX_SESSION_SECRET", ORIGINAL_SESSION_SECRET);
    resetEncryptionKeyCache();
  });

  it("round-trips a secret", () => {
    const ciphertext = encryptSecret("xoxb-super-secret-bot-token");
    expect(decryptSecret(ciphertext)).toBe("xoxb-super-secret-bot-token");
  });

  it("produces a versioned, non-plaintext envelope", () => {
    const ciphertext = encryptSecret("R0ABCDEFGHIJK");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(ciphertext).not.toContain("R0ABCDEFGHIJK");
    expect(ciphertext.split(".")).toHaveLength(4);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    // A deterministic ciphertext would let an observer confirm two rows hold
    // the same token by comparing bytes, without ever decrypting either.
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-value");
    expect(decryptSecret(b)).toBe("same-value");
  });

  it("rejects a tampered ciphertext instead of returning garbage", () => {
    const ciphertext = encryptSecret("hello");
    const parts = ciphertext.split(".");
    const dataPart = parts[3] ?? "";
    // Flip the first character of the ciphertext body.
    const flipped = (dataPart[0] === "A" ? "B" : "A") + dataPart.slice(1);
    const tampered = [...parts.slice(0, 3), flipped].join(".");

    expect(() => decryptSecret(tampered)).toThrow(CryptoUnavailableError);
  });

  it("rejects a value that is not in the envelope format", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow(CryptoUnavailableError);
    expect(() => decryptSecret("v2.a.b.c")).toThrow(CryptoUnavailableError);
  });

  it("refuses to encrypt when no key is configured", () => {
    delete process.env.VORTEX_ENCRYPTION_KEY;
    delete process.env.VORTEX_SESSION_SECRET;
    resetEncryptionKeyCache();

    expect(isEncryptionAvailable()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(CryptoUnavailableError);
  });

  it("falls back to deriving a key from the session secret", () => {
    delete process.env.VORTEX_ENCRYPTION_KEY;
    process.env.VORTEX_SESSION_SECRET = "a-session-secret-at-least-32-characters-long";
    resetEncryptionKeyCache();

    expect(isEncryptionAvailable()).toBe(true);
    expect(decryptSecret(encryptSecret("value"))).toBe("value");
  });

  it("rejects a malformed explicit key rather than silently weakening it", () => {
    process.env.VORTEX_ENCRYPTION_KEY = "too-short";
    resetEncryptionKeyCache();

    expect(() => encryptSecret("x")).toThrow(CryptoUnavailableError);
  });
});

describe("maskCredential", () => {
  it("keeps only the last four characters", () => {
    expect(maskCredential("EAAG1234567890abcdef")).toBe("••••cdef");
  });

  it("fully masks a very short value", () => {
    expect(maskCredential("abc")).toBe("••••");
  });

  it("returns empty for an empty value", () => {
    expect(maskCredential("")).toBe("");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskCredential("  abcdefgh  ")).toBe("••••efgh");
  });
});
