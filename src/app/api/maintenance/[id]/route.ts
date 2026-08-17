import { z } from "zod";

import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({ action: z.literal("cancel") });

export const PATCH = route("/api/maintenance/[id]", async (request, context) => {
  const { id } = await context.params;
  const windowId = id ?? "";

  const parsed = await readJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const session = await requirePermission("maintenance:manage");
  const repository = await getRepository();

  const window = await repository.cancelMaintenanceWindow(session.organization.id, windowId);
  // A cross-tenant or made-up id is a 404, never a 403 — the same convention
  // as everywhere else in this app.
  if (!window) return jsonError("not_found", "No such maintenance window in this organisation.", 404);

  await recordAudit(
    session,
    { action: "maintenance.cancel", targetType: "maintenance_window", targetId: window.id },
    request,
  );

  return jsonOk({ window });
});
