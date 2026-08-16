import { jsonOk, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 500;

/**
 * The audit trail for the current organisation.
 *
 * Read-only by construction: there is no POST, PATCH or DELETE here, and the
 * repository exposes no way to modify a row. An audit log that the application
 * can edit is worse than no audit log, because it is trusted.
 */
export const GET = route("/api/audit", async (request) => {
  const session = await requirePermission("audit:read");

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : 100;

  const action = url.searchParams.get("action") ?? undefined;

  const repository = await getRepository();
  const events = await repository.listAudit(session.organization.id, {
    limit,
    ...(action ? { action } : {}),
  });

  return jsonOk({ events, limit });
});
