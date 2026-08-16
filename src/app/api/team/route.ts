import { isLastOwner } from "@/lib/rbac";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";
import { inviteSchema } from "@/server/validation";
import type { Role } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("/api/team", async () => {
  const session = await requirePermission("team:read");
  const repository = await getRepository();

  const [members, overrides] = await Promise.all([
    repository.listMembers(session.organization.id),
    repository.listRoleOverrides(session.organization.id),
  ]);

  return jsonOk({ members, overrides });
});

export const POST = route("/api/team", async (request) => {
  const session = await requirePermission("team:invite");

  const body = await readJsonBody(request, inviteSchema);
  if (!body.ok) return body.response;

  const repository = await getRepository();
  const email = body.data.email.trim().toLowerCase();

  const members = await repository.listMembers(session.organization.id);
  if (members.some((member) => member.email.toLowerCase() === email)) {
    return jsonError("already_member", "That address is already on the team.", 409);
  }

  const member = await repository.inviteMember(session.organization.id, {
    name: body.data.name,
    email,
    role: body.data.role as Role,
  });

  await recordAudit(
    session,
    {
      action: "team.invite",
      targetType: "membership",
      targetId: member.id,
      metadata: { role: member.role },
    },
    request,
  );

  return jsonOk({ member }, { status: 201 });
});

/**
 * Guard shared by role changes and removals.
 *
 * Enforced on the server, not only by a disabled control: an account with no
 * owner cannot be administered and has no in-product way back.
 */
export async function assertNotLastOwner(
  orgId: string,
  memberId: string,
  nextRole: Role | null,
): Promise<string | null> {
  if (nextRole === "owner") return null;

  const repository = await getRepository();
  const members = await repository.listMembers(orgId);

  return isLastOwner(members, memberId)
    ? "This is the only Owner in this organisation. Promote someone else first."
    : null;
}
