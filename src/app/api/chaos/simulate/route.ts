import { clientKey, rateLimit } from "@/lib/rate-limit";
import { pickRandomService } from "@/lib/services";
import { notificationFromIncident } from "@/lib/webhooks/payloads";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, route } from "@/server/http";
import { notifyIntegrations } from "@/server/notifications";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chaos engineering drill.
 *
 * A discreet, deliberate "break something" button for the dashboard: it opens
 * a real CRITICAL incident against a random service, notifies every
 * integration subscribed to `incident.opened`, and hands back a duration the
 * client uses to drive a decaying metric spike (see `chaosMultiplier` in
 * `metrics-store.ts`) — so the health score, the charts and the incident list
 * all visibly react to one click, the way a real gameday exercise does.
 *
 * Rate-limited more tightly than a routine action: this deliberately pages
 * on-call integrations, and a flood of them would be a self-inflicted denial
 * of service against whichever channel is configured.
 */
const CHAOS_LIMIT = 5;
const CHAOS_WINDOW_MS = 5 * 60_000;

/** How long the client-side metric spike should decay for. */
export const CHAOS_SPIKE_DURATION_MS = 45_000;

export const POST = route("/api/chaos/simulate", async (request) => {
  const session = await requirePermission("chaos:trigger");

  const limit = rateLimit(
    `chaos:${session.organization.id}:${clientKey(request)}`,
    CHAOS_LIMIT,
    CHAOS_WINDOW_MS,
  );
  if (!limit.allowed) {
    return jsonError(
      "rate_limited",
      `Too many chaos drills. Try again in ${limit.retryAfter}s.`,
      429,
      { retryAfter: limit.retryAfter },
    );
  }

  const repository = await getRepository();
  const service = pickRandomService();
  const now = Date.now();

  const incident = await repository.createIncident(session.organization.id, {
    title: `CHAOS DRILL — Simulated failure on ${service.name}`,
    summary:
      `Chaos engineering drill triggered manually by ${session.user.name}. Synthetic 500-error and ` +
      `latency spike injected against ${service.name} to exercise the on-call and alerting path. ` +
      "No real user traffic is affected — this incident was opened deliberately, not detected.",
    serviceId: service.id,
    severity: "critical",
    status: "investigating",
    assigneeId: null,
    startedAt: now,
    ruleId: null,
    // A representative order of magnitude for the card, not a real count —
    // the summary already says so in words.
    impactedRequests: Math.round(service.baseline.throughputRps * 4),
    openingEvent: {
      at: now,
      kind: "opened",
      message: `Chaos drill started by ${session.user.name}.`,
      actor: session.user.name,
    },
  });

  await recordAudit(
    session,
    {
      action: "chaos.trigger",
      targetType: "incident",
      targetId: incident.id,
      metadata: { serviceId: service.id, serviceName: service.name },
    },
    request,
  );

  // Marked `test: true`: the delivered payload is truthfully labelled
  // "no live incident" everywhere that renders it, on top of the CHAOS DRILL
  // prefix already in the title — this is a deliberate exercise, and nobody
  // receiving it should mistake it for production actually being down.
  const notification = notificationFromIncident(incident, "incident.opened", { test: true });
  await notifyIntegrations(session.organization.id, notification);

  return jsonOk(
    {
      incident,
      service: { id: service.id, name: service.name },
      spikeDurationMs: CHAOS_SPIKE_DURATION_MS,
    },
    { status: 201 },
  );
});
