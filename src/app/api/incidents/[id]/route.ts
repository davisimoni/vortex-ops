import { z } from "zod";

import { canTransition, INCIDENT_STATUSES, STATUS_LABEL } from "@/lib/incidents";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";
import type { IncidentStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = INCIDENT_STATUSES as unknown as [string, ...string[]];

/**
 * One endpoint, three verbs, discriminated on `action`.
 *
 * They share a resource, a permission model and an audit shape; splitting them
 * into three routes would triple the tenant lookup and the not-found handling
 * for no gain in clarity.
 */
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("transition"), status: z.enum(statuses) }),
  z.object({ action: z.literal("assign"), assigneeId: z.string().max(64).nullable() }),
  z.object({ action: z.literal("comment"), message: z.string().min(1).max(2_000) }),
]);

/** Permission required per action — the table, not a chain of ifs. */
const REQUIRED = {
  transition: "incident:transition",
  assign: "incident:assign",
  comment: "incident:comment",
} as const;

export const GET = route("/api/incidents/[id]", async (_request, context) => {
  const session = await requirePermission("incident:read");
  const { id } = await context.params;

  const repository = await getRepository();
  const incident = await repository.getIncident(session.organization.id, id ?? "");

  if (!incident) return jsonError("not_found", "No such incident in this organisation.", 404);
  return jsonOk({ incident });
});

export const PATCH = route("/api/incidents/[id]", async (request, context) => {
  const { id } = await context.params;
  const incidentId = id ?? "";

  const parsed = await readJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  // Permission is resolved from the action, so a Viewer cannot reach the
  // repository at all — the 403 happens before anything is read or written.
  const session = await requirePermission(REQUIRED[parsed.data.action]);
  const repository = await getRepository();

  const current = await repository.getIncident(session.organization.id, incidentId);
  // A cross-tenant id is a 404, never a 403: "you may not touch this" confirms
  // the incident exists in somebody's account.
  if (!current) return jsonError("not_found", "No such incident in this organisation.", 404);

  const now = Date.now();

  if (parsed.data.action === "transition") {
    const next = parsed.data.status as IncidentStatus;
    if (current.status === next) return jsonOk({ incident: current });

    if (!canTransition(current.status, next)) {
      // The state machine is enforced server-side, not only by the disabled
      // buttons in the stepper.
      await recordAudit(
        session,
        {
          action: "incident.transition",
          targetType: "incident",
          targetId: incidentId,
          outcome: "denied",
          metadata: { from: current.status, to: next, reason: "illegal transition" },
        },
        request,
      );
      return jsonError(
        "invalid_transition",
        `${STATUS_LABEL[current.status]} cannot move directly to ${STATUS_LABEL[next]}.`,
        409,
        { from: current.status, to: next },
      );
    }

    const wasResolved = current.status === "resolved";
    const incident = await repository.updateIncident(
      session.organization.id,
      incidentId,
      {
        status: next,
        // Reopening clears the resolution timestamp: leaving a stale one would
        // let MTTR be computed from a resolution that no longer holds.
        resolvedAt: next === "resolved" ? now : wasResolved ? null : undefined,
      },
      {
        at: now,
        kind: "status",
        message: `Status changed from ${STATUS_LABEL[current.status]} to ${STATUS_LABEL[next]}.`,
        actor: session.user.name,
      },
    );

    await recordAudit(
      session,
      {
        action: "incident.transition",
        targetType: "incident",
        targetId: incidentId,
        metadata: { from: current.status, to: next },
      },
      request,
    );

    return jsonOk({ incident });
  }

  if (parsed.data.action === "assign") {
    const assigneeId = parsed.data.assigneeId;

    if (assigneeId !== null) {
      // The assignee must be a member of *this* organisation. Without the
      // check, one tenant could name a user from another as its responder.
      const members = await repository.listMembers(session.organization.id);
      const target = members.find((member) => member.id === assigneeId);
      if (!target) {
        return jsonError("invalid_assignee", "That person is not a member of this organisation.", 422);
      }

      const incident = await repository.updateIncident(
        session.organization.id,
        incidentId,
        { assigneeId },
        {
          at: now,
          kind: "assignment",
          message: `Assigned to ${target.name}.`,
          actor: session.user.name,
        },
      );

      await recordAudit(
        session,
        {
          action: "incident.assign",
          targetType: "incident",
          targetId: incidentId,
          metadata: { assigneeId },
        },
        request,
      );

      return jsonOk({ incident });
    }

    const incident = await repository.updateIncident(
      session.organization.id,
      incidentId,
      { assigneeId: null },
      { at: now, kind: "assignment", message: "Assignment cleared.", actor: session.user.name },
    );

    await recordAudit(
      session,
      {
        action: "incident.assign",
        targetType: "incident",
        targetId: incidentId,
        metadata: { assigneeId: null },
      },
      request,
    );

    return jsonOk({ incident });
  }

  const message = parsed.data.message.trim();
  if (message.length === 0) return jsonError("invalid_request", "Write something first.", 400);

  const incident = await repository.appendIncidentEvent(session.organization.id, incidentId, {
    at: now,
    kind: "note",
    message,
    actor: session.user.name,
  });

  await recordAudit(
    session,
    {
      action: "incident.comment",
      targetType: "incident",
      targetId: incidentId,
      // The note body is deliberately not copied into the audit metadata: it is
      // already on the timeline, and duplicating free text into an append-only
      // table doubles the places a stray secret has to be scrubbed from.
      metadata: { length: message.length },
    },
    request,
  );

  return jsonOk({ incident });
});
