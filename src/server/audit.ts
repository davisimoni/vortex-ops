import { logger, redact, type LogValue } from "@/lib/logger";
import type { SessionSnapshot } from "@/lib/session";
import { getRepository } from "@/server/repository";
import type { AuditOutcome } from "@/server/repository/types";

/**
 * Audit trail.
 *
 * Every state change a human causes gets a row: who, what, which tenant, when,
 * from where, and whether it succeeded. **Denials are recorded too** — a log
 * that only contains successful actions cannot answer "did anyone try", which
 * is most of what an access review is actually looking for.
 *
 * Metadata is redacted with the same function the logger uses, so a caller who
 * spreads a whole request body into an audit entry cannot write a bot token
 * into a table that is, by design, never deleted.
 */

export interface AuditInput {
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly outcome?: AuditOutcome;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Client address for the audit row.
 *
 * Recorded as evidence, not as identity: `x-forwarded-for` is attacker-supplied
 * unless a trusted proxy sets it, so it belongs in the log next to the action,
 * never in an authorisation decision.
 */
function clientIp(request: Request | undefined): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || null;
}

export async function recordAudit(
  session: Pick<SessionSnapshot, "user" | "organization">,
  input: AuditInput,
  request?: Request,
): Promise<void> {
  try {
    const repository = await getRepository();
    await repository.appendAudit({
      orgId: session.organization.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      outcome: input.outcome ?? "success",
      metadata: (redact((input.metadata ?? {}) as LogValue) ?? {}) as Record<string, unknown>,
      ip: clientIp(request),
    });
  } catch (error) {
    /*
     * A failed audit write does not fail the action.
     *
     * The strict compliance reading is the opposite — no audit, no action — and
     * for a system of record that is right. It is not right here: a transient
     * database blip would then block an on-call engineer from resolving an
     * incident, which trades a gap in the log for an extension of the outage.
     * The compromise is that the failure is logged at error level with the
     * entry that was lost, so it is recoverable from the application logs. A
     * production deployment that needs the strict guarantee should write
     * through a durable queue instead of accepting either trade.
     */
    logger.exception("Audit write failed", error, {
      action: input.action,
      orgId: session.organization.id,
      actorId: session.user.id,
    });
  }
}

/** Records a refused action. The denial *is* the interesting event. */
export async function recordDenial(
  session: Pick<SessionSnapshot, "user" | "organization">,
  action: string,
  reason: string,
  request?: Request,
): Promise<void> {
  await recordAudit(
    session,
    { action, targetType: "authorization", outcome: "denied", metadata: { reason } },
    request,
  );
}

/** Human-readable labels for the audit table and the compliance export. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_out": "Signed out",
  "auth.sign_in_failed": "Failed sign-in",
  "auth.demo_session": "Auto-provisioned demo session",
  "session.switch_organization": "Switched organisation",
  "incident.create": "Declared incident",
  "incident.transition": "Changed incident status",
  "incident.assign": "Assigned responder",
  "incident.comment": "Posted timeline note",
  "chaos.trigger": "Ran a chaos engineering drill",
  "integration.create": "Created integration",
  "integration.update": "Updated integration",
  "integration.delete": "Removed integration",
  "integration.trigger": "Sent notification",
  "integration.test": "Sent test payload",
  "team.invite": "Invited member",
  "team.role_update": "Changed member role",
  "team.remove": "Removed member",
  "rbac.override": "Changed permission matrix",
  "compliance.export": "Exported compliance report",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}
