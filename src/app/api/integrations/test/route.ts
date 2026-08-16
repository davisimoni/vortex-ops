import { z } from "zod";

import { clientKey, rateLimit } from "@/lib/rate-limit";
import { deliverWebhook } from "@/lib/webhooks/delivery";
import { sampleNotification } from "@/lib/webhooks/payloads";
import { PROVIDER_IDS, WEBHOOK_EVENTS } from "@/lib/webhooks/providers";
import { recordAudit } from "@/server/audit";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { requirePermission } from "@/server/session/context";
import type { IntegrationProvider } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  provider: z.enum(PROVIDER_IDS as unknown as [string, ...string[]]),
  targetUrl: z.string().min(1).max(2_048),
  event: z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]).optional(),
  /** Bot token or routing key for a draft that has not been saved yet. */
  credential: z.string().max(512).optional(),
  /** Chat id or recipient list. */
  destination: z.string().max(512).optional(),
});

const TEST_LIMIT = 10;
const TEST_WINDOW_MS = 60_000;

/**
 * Sends a test payload for an integration that has **not been saved yet**.
 *
 * This is the builder's "does my endpoint accept this" button. For a stored
 * integration use `/api/integrations/trigger`, which loads and decrypts the
 * credential server-side instead of taking it from the browser.
 *
 * The route makes an outbound HTTP request to a caller-supplied URL, which is
 * the classic SSRF shape. Standing between it and abuse:
 *   1. a session and the `integration:test` permission — anonymous callers and
 *      Viewers cannot reach the network through us;
 *   2. a per-tenant rate limit, so it is not a convenient scanner;
 *   3. `checkWebhookUrl` inside `deliverWebhook`, which rejects private,
 *      loopback and link-local destinations at send time, not just at save time.
 */
export const POST = route("/api/integrations/test", async (request) => {
  const session = await requirePermission("integration:test");

  const limit = rateLimit(
    `webhook-test:${session.organization.id}:${clientKey(request)}`,
    TEST_LIMIT,
    TEST_WINDOW_MS,
  );
  if (!limit.allowed) {
    return jsonError("rate_limited", `Too many test sends. Try again in ${limit.retryAfter}s.`, 429, {
      retryAfter: limit.retryAfter,
    });
  }

  const body = await readJsonBody(request, schema);
  if (!body.ok) return body.response;

  const provider = body.data.provider as IntegrationProvider;

  const result = await deliverWebhook({
    provider,
    targetUrl: body.data.targetUrl,
    notification: sampleNotification(
      (body.data.event as (typeof WEBHOOK_EVENTS)[number] | undefined) ?? "incident.opened",
    ),
    ...(body.data.credential ? { credential: body.data.credential } : {}),
    ...(body.data.destination ? { destination: body.data.destination } : {}),
  });

  await recordAudit(
    session,
    {
      action: "integration.test",
      targetType: "integration",
      targetId: null,
      outcome: result.ok ? "success" : "failure",
      // The URL is not recorded: for Slack and Discord it *is* the credential.
      metadata: { provider, status: result.status },
    },
    request,
  );

  return jsonOk({ result, remaining: limit.remaining });
});
