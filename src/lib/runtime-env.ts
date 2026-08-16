/**
 * Whether this process is genuinely a live, public production deployment.
 *
 * `VORTEX_ENV=production` is this app's own label, and it has to be set by
 * hand in whatever hosts it. Forgetting it does not fail loudly — every check
 * gated on it (a session-signing secret being required, the demo password
 * safety check, the SSRF guard's private-host relaxation) silently falls back
 * to its permissive *development* behaviour instead of its strict production
 * one. On Vercel specifically, that gap is what turns a missing
 * `VORTEX_SESSION_SECRET` into an inexplicable `ERR_TOO_MANY_REDIRECTS`
 * rather than the clear, actionable error the code already intended to throw:
 * every serverless instance falls into the "no secret configured" branch,
 * generates its *own* random ephemeral secret, and a session cookie signed by
 * one instance fails to verify on the next request if it lands on another.
 *
 * `VERCEL_ENV` is set automatically by Vercel on every deployment — "production",
 * "preview" or "development" — with no configuration step to forget, so it is
 * checked as a second, independent signal for exactly the case that matters:
 * a real Vercel production deployment where nobody remembered to set
 * `VORTEX_ENV`.
 *
 * Deliberately not `process.env.NODE_ENV`: `npm run build && npm start` sets
 * it to `"production"` locally too, including in this project's own E2E
 * suite, which needs the demo password and a locally-provided session secret
 * to keep working exactly as they do in development. `NODE_ENV` answers "was
 * this built for production," not "is this instance living on the public
 * internet," and only the second question is what these checks care about.
 */
export function isProductionDeployment(): boolean {
  // `process` is absent in some edge/browser bundles; guard rather than assume.
  if (typeof process === "undefined" || !process.env) return false;
  return process.env.VORTEX_ENV === "production" || process.env.VERCEL_ENV === "production";
}
