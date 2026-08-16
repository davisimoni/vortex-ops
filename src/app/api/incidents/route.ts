import { z } from "zod";

import { DEFAULT_RULES } from "@/lib/alerting";
import { INCIDENT_SEVERITIES } from "@/lib/incidents";
import { SERVICES } from "@/lib/services";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission, requireSession } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const severities = INCIDENT_SEVERITIES as unknown as [string, ...string[]];
const serviceIds = SERVICES.map((service) => service.id) as unknown as [string, ...string[]];

const ruleIds = DEFAULT_RULES.map((rule) => rule.id) as unknown as [string, ...string[]];

const createSchema = z.object({
  title: z.string().min(4).max(200),
  summary: z.string().min(4).max(4_000),
  serviceId: z.enum(serviceIds),
  severity: z.enum(severities),
  /*
   * Set when the alerting engine opened this, absent when a human declared it.
   * Constrained to known rule ids rather than accepted as free text: the field
   * is what stops a rule re-firing for an incident it already opened, and an
   * arbitrary string there would let a client silence an alert permanently.
   */
  ruleId: z.enum(ruleIds).optional(),
});

/** Every incident this tenant can see — and only this tenant's. */
export const GET = route("/api/incidents", async () => {
  const session = await requirePermission("incident:read");
  const repository = await getRepository();
  const incidents = await repository.listIncidents(session.organization.id);
  return jsonOk({ incidents });
});

export const POST = route("/api/incidents", async (request) => {
  const session = await requirePermission("incident:create");

  const body = await readJsonBody(request, createSchema);
  if (!body.ok) return body.response;

  const repository = await getRepository();
  const now = Date.now();

  const incident = await repository.createIncident(session.organization.id, {
    title: body.data.title.trim(),
    summary: body.data.summary.trim(),
    serviceId: body.data.serviceId,
    severity: body.data.severity as (typeof INCIDENT_SEVERITIES)[number],
    // A manually declared incident always starts at the beginning of the
    // lifecycle. Letting the caller pick a later status would allow a
    // post-mortem timeline that begins at "Monitoring" with nothing before it.
    status: "investigating",
    assigneeId: null,
    startedAt: now,
    ruleId: body.data.ruleId ?? null,
    impactedRequests: 0,
    openingEvent: {
      at: now,
      kind: "opened",
      message: body.data.ruleId
        ? `Opened by alert rule ${body.data.ruleId}.`
        : "Declared manually.",
      // The alerting engine is not a person, and the timeline should not
      // pretend otherwise.
      actor: body.data.ruleId ? null : session.user.name,
    },
  });

  await recordAudit(
    session,
    {
      action: "incident.create",
      targetType: "incident",
      targetId: incident.id,
      metadata: { severity: incident.severity, service: incident.serviceId },
    },
    request,
  );

  return jsonOk({ incident }, { status: 201 });
});

/** Rejects an unknown method with the right status instead of a 404. */
export const PUT = route("/api/incidents", async () => {
  await requireSession();
  return jsonError("method_not_allowed", "Use POST to declare an incident.", 405);
});
