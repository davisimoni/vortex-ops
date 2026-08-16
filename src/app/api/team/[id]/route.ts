import { z } from "zod";

import { assertNotLastOwner } from "@/app/api/team/route";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";
import { roleSchema } from "@/server/validation";
import type { Role } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({ role: roleSchema });

export const PATCH = route("/api/team/[id]", async (request, context) => {
  const session = await requirePermission("team:role:update");
  const { id } = await context.params;
  const memberId = id ?? "";

  const body = await readJsonBody(request, patchSchema);
  if (!body.ok) return body.response;

  const role = body.data.role as Role;

  const blocked = await assertNotLastOwner(session.organization.id, memberId, role);
  if (blocked) {
    await recordAudit(
      session,
      {
        action: "team.role_update",
        targetType: "membership",
        targetId: memberId,
        outcome: "denied",
        metadata: { reason: "last owner", role },
      },
      request,
    );
    return jsonError("last_owner", blocked, 409);
  }

  const repository = await getRepository();
  const member = await repository.updateMemberRole(session.organization.id, memberId, role);

  if (!member) return jsonError("not_found", "That person is not a member of this organisation.", 404);

  await recordAudit(
    session,
    {
      action: "team.role_update",
      targetType: "membership",
      targetId: memberId,
      metadata: { role },
    },
    request,
  );

  return jsonOk({ member });
});

export const DELETE = route("/api/team/[id]", async (request, context) => {
  const session = await requirePermission("team:remove");
  const { id } = await context.params;
  const memberId = id ?? "";

  const blocked = await assertNotLastOwner(session.organization.id, memberId, null);
  if (blocked) return jsonError("last_owner", blocked, 409);

  const repository = await getRepository();
  const removed = await repository.removeMember(session.organization.id, memberId);

  if (!removed) return jsonError("not_found", "That person is not a member of this organisation.", 404);

  await recordAudit(
    session,
    { action: "team.remove", targetType: "membership", targetId: memberId },
    request,
  );

  return jsonOk({ removed: true });
});
