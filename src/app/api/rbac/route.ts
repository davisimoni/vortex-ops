import { z } from "zod";

import { PERMISSIONS, effectivePermissions, type Permission } from "@/lib/rbac";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";
import { roleSchema } from "@/server/validation";
import type { Role } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  role: roleSchema,
  permission: z.enum(PERMISSIONS as unknown as [string, ...string[]]),
  /** `null` clears the override and restores the built-in default. */
  granted: z.boolean().nullable(),
});

/**
 * Permissions that cannot be revoked from an Owner.
 *
 * Without this an Owner can remove their own ability to manage roles and lock
 * every administrator out of the organisation permanently — the same failure
 * the last-owner guard prevents, reached by a different door.
 */
const OWNER_LOCKED: readonly Permission[] = ["team:role:update", "team:read"];

export const GET = route("/api/rbac", async () => {
  const session = await requirePermission("team:read");
  const repository = await getRepository();
  const overrides = await repository.listRoleOverrides(session.organization.id);

  return jsonOk({
    overrides,
    // The resolved matrix, so the UI renders what is enforced rather than
    // re-deriving it and risking a different answer.
    matrix: {
      owner: effectivePermissions("owner", overrides),
      devops: effectivePermissions("devops", overrides),
      viewer: effectivePermissions("viewer", overrides),
    },
  });
});

export const PATCH = route("/api/rbac", async (request) => {
  const session = await requirePermission("team:role:update");

  const body = await readJsonBody(request, patchSchema);
  if (!body.ok) return body.response;

  const role = body.data.role as Role;
  const permission = body.data.permission as Permission;

  if (role === "owner" && body.data.granted === false && OWNER_LOCKED.includes(permission)) {
    return jsonError(
      "locked_permission",
      "Owners cannot lose the ability to manage roles — it would leave the organisation with no administrator.",
      409,
    );
  }

  const repository = await getRepository();
  await repository.setRoleOverride(session.organization.id, role, permission, body.data.granted);

  const overrides = await repository.listRoleOverrides(session.organization.id);

  await recordAudit(
    session,
    {
      action: "rbac.override",
      targetType: "role",
      targetId: role,
      metadata: { permission, granted: body.data.granted },
    },
    request,
  );

  return jsonOk({
    overrides,
    matrix: {
      owner: effectivePermissions("owner", overrides),
      devops: effectivePermissions("devops", overrides),
      viewer: effectivePermissions("viewer", overrides),
    },
  });
});
