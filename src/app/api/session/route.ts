import { jsonError, jsonOk, route } from "@/server/http";
import { readSession } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The client's view of who it is.
 *
 * Returns the resolved permission set, not just the role: the browser must
 * never re-derive permissions from a role, or a tenant's customised matrix
 * would apply on the server and not in the UI, and the two would disagree about
 * what is allowed.
 */
export const GET = route("/api/session", async () => {
  const session = await readSession();
  if (!session) return jsonError("unauthorized", "Not signed in.", 401);
  return jsonOk(session);
});
