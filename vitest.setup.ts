/**
 * Global test environment.
 *
 * A fixed, sufficiently long session secret so `src/server/session/cookie.ts`
 * signs deterministically instead of falling back to a per-process random one
 * — the fallback is real and intentional in dev, but it would make signature
 * assertions flaky across test files. `VORTEX_ENV` stays unset (not
 * "production") so the fallback paths that only trigger outside production
 * remain exercisable by tests that want them.
 */
process.env.VORTEX_SESSION_SECRET ??= "test-session-secret-0123456789-abcdefghijklmnop";
process.env.TZ = "UTC";
