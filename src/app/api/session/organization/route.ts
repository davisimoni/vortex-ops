import { cookies } from "next/headers";
import { z } from "zod";

import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { encodeSession, sessionCookie } from "@/server/session/cookie";
import { requireSession } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ organizationId: z.string().min(1).max(64) });

/**
 * Switches the active tenant.
 *
 * The membership is re-checked here rather than trusting the id the browser
 * sent. Without that check, the organisation switcher *is* the tenant isolation
 * bypass: post any organisation id and the next request carries a cookie
 * claiming you belong to it.
 *
 * The new selection is written into a freshly signed cookie, so it survives a
 * reload and cannot be forged by editing the old one.
 */
export const POST = route("/api/session/organization", async (request) => {
  const session = await requireSession();

  const body = await readJsonBody(request, schema);
  if (!body.ok) return body.response;

  const repository = await getRepository();
  const membership = await repository.getMembership(session.user.id, body.data.organizationId);

  if (!membership || membership.status !== "active") {
    // Deliberately the same answer as a nonexistent organisation: probing this
    // endpoint must not reveal which tenants exist.
    await recordAudit(
      session,
      {
        action: "session.switch_organization",
        targetType: "organization",
        targetId: body.data.organizationId,
        outcome: "denied",
        metadata: { reason: "no active membership" },
      },
      request,
    );
    return jsonError("forbidden", "You are not an active member of that organisation.", 403);
  }

  const organization = await repository.getOrganization(body.data.organizationId);
  if (!organization) return jsonError("not_found", "That organisation no longer exists.", 404);

  const jar = await cookies();
  jar.set(sessionCookie(encodeSession(session.user.id, organization.id)));

  await repository.touchMembership(session.user.id, organization.id, Date.now());
  await recordAudit(
    { user: session.user, organization: { ...session.organization, id: organization.id } },
    {
      action: "session.switch_organization",
      targetType: "organization",
      targetId: organization.id,
      metadata: { from: session.organization.slug, to: organization.slug },
    },
    request,
  );

  return jsonOk({
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      environment: organization.environment,
    },
    role: membership.role,
  });
});
