import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Envelope encryption for third-party credentials at rest.
 *
 * What is protected: Discord webhook URLs, Telegram bot tokens, PagerDuty
 * routing keys. These are not passwords to *our* system — they are the ability
 * to post as the customer's agency into the customer's channels, and to page
 * the customer's on-call rotation. In plaintext they are readable from any
 * database copy, any backup, and any `SELECT *` in a support session.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a tampered row fails to
 * decrypt rather than silently yielding an attacker-chosen value.
 *
 * The format is `v1.<iv>.<tag>.<ciphertext>`, all base64url. Versioned from the
 * start because the alternative to a version tag is a migration you cannot
 * write — you would have no way to tell old rows from new ones.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Raised when encryption is unavailable or a value cannot be authenticated. */
export class CryptoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoUnavailableError";
  }
}

let cachedKey: Buffer | null | undefined;

/**
 * Resolves the data key.
 *
 * `VORTEX_ENCRYPTION_KEY` is expected to be 32 bytes as hex or base64. If it is
 * absent we derive from `VORTEX_SESSION_SECRET` rather than inventing a random
 * key per process — a random key would encrypt rows this process could read and
 * the next one could not, which looks like data loss.
 */
function resolveKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const raw = process.env.VORTEX_ENCRYPTION_KEY?.trim();

  if (raw && raw.length > 0) {
    const decoded = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");

    if (decoded.length === KEY_BYTES) {
      cachedKey = decoded;
      return cachedKey;
    }
    // A short key is a configuration mistake, not a reason to silently stretch
    // it into something that looks strong.
    throw new CryptoUnavailableError(
      `VORTEX_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (64 hex chars or 44 base64 chars).`,
    );
  }

  const sessionSecret = process.env.VORTEX_SESSION_SECRET?.trim();
  if (sessionSecret && sessionSecret.length >= 32) {
    cachedKey = scryptSync(sessionSecret, "vortex-credential-encryption", KEY_BYTES);
    return cachedKey;
  }

  cachedKey = null;
  return cachedKey;
}

/** `true` when credentials can be stored. Routes check this before accepting one. */
export function isEncryptionAvailable(): boolean {
  try {
    return resolveKey() !== null;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  if (!key) {
    // Refusing is the point. Falling back to plaintext would make the
    // protection bypassable by simply removing an environment variable.
    throw new CryptoUnavailableError(
      "No encryption key configured. Set VORTEX_ENCRYPTION_KEY (or a 32+ character VORTEX_SESSION_SECRET) before storing credentials.",
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const key = resolveKey();
  if (!key) throw new CryptoUnavailableError("No encryption key configured.");

  const parts = payload.split(".");
  const [version, ivPart, tagPart, dataPart] = parts;

  if (parts.length !== 4 || version !== VERSION || !ivPart || !tagPart || !dataPart) {
    // A value that is not in our envelope format is not "probably plaintext we
    // can use" — it is a value we did not write, and using it would let anyone
    // who can write to the database bypass encryption entirely.
    throw new CryptoUnavailableError("Stored credential is not in the expected encrypted format.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CryptoUnavailableError(
      "Stored credential failed authentication. It was written with a different key, or the row was modified.",
    );
  }
}

/**
 * The only form of a credential that is allowed back to the browser.
 * Last four characters, everything else masked — enough to confirm *which*
 * token is configured, not enough to use it.
 */
export function maskCredential(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/** Test seam: the key is cached per process, so tests must be able to drop it. */
export function resetEncryptionKeyCache(): void {
  cachedKey = undefined;
}
