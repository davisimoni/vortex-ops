import { z } from "zod";

import { SERVICES } from "@/lib/services";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const serviceIds = SERVICES.map((service) => service.id) as unknown as [string, ...string[]];

const createSchema = z
  .object({
    title: z.string().trim().min(4).max(200),
    description: z.string().trim().max(4_000).default(""),
    serviceIds: z.array(z.enum(serviceIds)).min(1).max(SERVICES.length),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
  })
  .refine((body) => body.endsAt > body.startsAt, {
    message: "endsAt must be after startsAt.",
    path: ["endsAt"],
  });

/** Every maintenance window this tenant has scheduled — past, present and future. */
export const GET = route("/api/maintenance", async () => {
  const session = await requirePermission("incident:read");
  const repository = await getRepository();
  const windows = await repository.listMaintenanceWindows(session.organization.id);
  return jsonOk({ windows });
});

export const POST = route("/api/maintenance", async (request) => {
  const session = await requirePermission("maintenance:manage");

  const body = await readJsonBody(request, createSchema);
  if (!body.ok) return body.response;

  const repository = await getRepository();
  const window = await repository.createMaintenanceWindow(session.organization.id, {
    title: body.data.title,
    description: body.data.description,
    serviceIds: body.data.serviceIds,
    startsAt: body.data.startsAt,
    endsAt: body.data.endsAt,
  });

  await recordAudit(
    session,
    {
      action: "maintenance.create",
      targetType: "maintenance_window",
      targetId: window.id,
      metadata: { services: window.serviceIds, startsAt: window.startsAt, endsAt: window.endsAt },
    },
    request,
  );

  return jsonOk({ window }, { status: 201 });
});

/** Rejects an unknown method with the right status instead of a 404. */
export const PUT = route("/api/maintenance", async () => {
  await requirePermission("incident:read");
  return jsonError("method_not_allowed", "Use POST to schedule a maintenance window.", 405);
});
