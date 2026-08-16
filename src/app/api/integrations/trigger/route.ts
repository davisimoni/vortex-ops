import { z } from "zod";

import { clientKey, rateLimit } from "@/lib/rate-limit";
import { deliverWebhook } from "@/lib/webhooks/delivery";
import { sampleNotification } from "@/lib/webhooks/payloads";
import { PROVIDERS, WEBHOOK_EVENTS } from "@/lib/webhooks/providers";
import { recordAudit } from "@/server/audit";
import { CryptoUnavailableError } from "@/server/crypto/secrets";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  integrationId: z.string().min(1).max(64),
  event: z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]).optional(),
});

const TRIGGER_LIMIT = 10;
const TRIGGER_WINDOW_MS = 60_000;

/**
 * Fires a real notification through a saved integration.
 *
 * The distinction from `/api/integrations/test` matters: **test** validates an
 * unsaved draft the browser is holding, so the caller supplies everything.
 * **Trigger** fires a stored integration, so the credential is loaded and
 * decrypted server-side and never travels through the browser at all. That is
 * the only way a Telegram bot token can be used without the page that uses it
 * ever having seen it.
 *
 * The payload is the sample incident, clearly marked `TEST —`. It lands in the
 * same channel as real pages, and somebody will forward it.
 */
export const POST = route("/api/integrations/trigger", async (request) => {
  const session = await requirePermission("integration:test");

  const limit = rateLimit(
    `trigger:${session.organization.id}:${clientKey(request)}`,
    TRIGGER_LIMIT,
    TRIGGER_WINDOW_MS,
  );
  if (!limit.allowed) {
    return jsonError(
      "rate_limited",
      `Too many notifications. Try again in ${limit.retryAfter}s.`,
      429,
      { retryAfter: limit.retryAfter },
    );
  }

  const body = await readJsonBody(request, schema);
  if (!body.ok) return body.response;

  const repository = await getRepository();

  let record;
  try {
    record = await repository.getIntegrationWithCredential(
      session.organization.id,
      body.data.integrationId,
    );
  } catch (error) {
    if (error instanceof CryptoUnavailableError) {
      // The row exists but cannot be read with the current key — usually a
      // rotated or missing VORTEX_ENCRYPTION_KEY. Say so; a generic 500 sends
      // somebody hunting through logs for a configuration problem.
      return jsonError(
        "credential_unreadable",
        "The stored credential could not be decrypted. It was written with a different encryption key — re-enter it to repair this integration.",
        503,
      );
    }
    throw error;
  }

  if (!record) return jsonError("not_found", "No such integration in this organisation.", 404);

  const { integration, credential } = record;
  const definition = PROVIDERS[integration.provider];

  if (definition.credential !== "none" && !credential?.token) {
    return jsonError(
      "credential_required",
      `${definition.label} has no ${definition.credentialLabels?.token ?? "credential"} stored. Add one before sending.`,
      422,
    );
  }

  const event = (body.data.event ?? integration.events[0] ?? "incident.opened") as
    (typeof WEBHOOK_EVENTS)[number];

  const result = await deliverWebhook({
    provider: integration.provider,
    targetUrl: integration.targetUrl,
    notification: sampleNotification(event),
    ...(credential?.token ? { credential: credential.token } : {}),
    ...(credential?.destination ? { destination: credential.destination } : {}),
  });

  await repository.recordDelivery(session.organization.id, integration.id, result);

  await recordAudit(
    session,
    {
      action: "integration.trigger",
      targetType: "integration",
      targetId: integration.id,
      outcome: result.ok ? "success" : "failure",
      metadata: {
        provider: integration.provider,
        event,
        status: result.status,
        durationMs: result.durationMs,
      },
    },
    request,
  );

  // A failed delivery is a successful *report*: the UI renders the reason.
  return jsonOk({ result, remaining: limit.remaining });
});
