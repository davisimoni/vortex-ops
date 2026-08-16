import { cookies } from "next/headers";

import { recordAudit } from "@/server/audit";
import { jsonOk, route } from "@/server/http";
import { clearedSessionCookie } from "@/server/session/cookie";
import { readSession } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out.
 *
 * POST, not GET: a GET would let any page log the user out with an `<img>` tag,
 * and a prefetching browser could do it by accident.
 *
 * The session is stateless, so "signing out" is clearing the cookie. That is
 * honest about its limit — a token already copied off the machine stays valid
 * until it expires. A server-side revocation list is the fix when that matters,
 * and it is a real table, not a comment.
 */
export const POST = route("/api/auth/sign-out", async (request) => {
  const session = await readSession();

  if (session) {
    await recordAudit(session, { action: "auth.sign_out", targetType: "session" }, request);
  }

  const jar = await cookies();
  jar.set(clearedSessionCookie());

  return jsonOk({ signedOut: true });
});
