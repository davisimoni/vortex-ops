import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt rather than bcrypt or a bare SHA: it is memory-hard, so an attacker
 * with a GPU farm gains far less than they would against a compute-only KDF,
 * and it ships in Node's standard library — no native module to compile, which
 * is what usually turns "add auth" into a build problem on Windows and in CI.
 *
 * The stored format carries its own parameters:
 *
 *     scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
 *
 * Parameters live in the hash, not in a constant, so raising the cost later
 * does not invalidate existing passwords — old hashes keep verifying with the
 * parameters they were written with, and `needsRehash` says which ones to
 * upgrade on next successful sign-in.
 */

const PREFIX = "scrypt";
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** ~64 MB of memory per hash. Costly for an attacker, ~100ms for one sign-in. */
const DEFAULT_PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;

/** scrypt needs roughly `128 * N * r` bytes; give it headroom or it throws. */
function maxmemFor(N: number, r: number): number {
  return 256 * N * r;
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });

  return [PREFIX, N, r, p, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

/**
 * Verifies a candidate against a stored hash.
 *
 * Returns `false` for a malformed record rather than throwing: a corrupt row
 * must read as "wrong password", never as a 500 that tells an attacker the
 * account exists and something unusual is stored against it.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltPart = parts[4];
  const hashPart = parts[5];

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (!saltPart || !hashPart) return false;
  // Guard against a hostile row demanding gigabytes of memory to verify.
  if (N > 2 ** 20 || r > 32 || p > 16) return false;

  const expected = Buffer.from(hashPart, "base64url");

  try {
    const derived = await scrypt(password.normalize("NFKC"), Buffer.from(saltPart, "base64url"), expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
    // Constant time: a byte-by-byte early exit leaks the hash one probe at a time.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** `true` when a stored hash uses weaker parameters than the current default. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return true;
  return Number(parts[1]) < DEFAULT_PARAMS.N;
}
