import { createHmac, timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";
import { checkWebhookUrl } from "@/lib/net/safe-url";
import {
  EVENT_HEADER,
  PROVIDERS,
  resolveEndpoint,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "@/lib/webhooks/providers";
import { buildPayload, type IncidentNotification } from "@/lib/webhooks/payloads";
import type { DeliveryResult, IntegrationProvider } from "@/types";

/**
 * Outbound webhook delivery. Server only — imports `node:crypto`.
 *
 * Three things this module refuses to do:
 *  - deliver to an address the SSRF guard rejects, even if the record was saved
 *    earlier and passed then (DNS can be re-pointed after save);
 *  - hang. Every request carries an AbortSignal timeout, because a customer
 *    endpoint that never responds would otherwise pin a serverless invocation
 *    until the platform kills it;
 *  - echo the response body back to the caller. A remote server's HTML error
 *    page rendered in our UI is a stored-XSS delivery mechanism, so only a
 *    short, escaped excerpt travels back.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_EXCERPT = 240;

/** Signing secret, or `null` when the deployment has not configured one. */
function signingSecret(): string | null {
  const secret = process.env.VORTEX_WEBHOOK_SIGNING_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/**
 * `v1=<hex>` over `${timestamp}.${body}`.
 *
 * The timestamp is inside the signed string so a captured payload cannot be
 * replayed later — the receiver rejects anything older than its own tolerance.
 */
export function signPayload(body: string, timestamp: number, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${body}`);
  return `v1=${hmac.digest("hex")}`;
}

/** Constant-time comparison, for the verification snippet we document. */
export function verifySignature(
  body: string,
  timestamp: number,
  secret: string,
  candidate: string,
): boolean {
  const expected = Buffer.from(signPayload(body, timestamp, secret));
  const actual = Buffer.from(candidate);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export interface DeliveryRequest {
  readonly provider: IntegrationProvider;
  readonly targetUrl: string;
  readonly notification: IncidentNotification;
  /** PagerDuty routing key, Telegram bot token, relay API key. Never logged. */
  readonly credential?: string;
  /** Telegram chat id, or the email recipient list. */
  readonly destination?: string;
  readonly timeoutMs?: number;
}

/**
 * Some providers answer 200 with a failure in the body.
 *
 * Telegram returns `{"ok":false,"description":"chat not found"}` under a 200 for
 * several real misconfigurations. Treating HTTP status as the whole answer
 * would show a green tick for a channel that received nothing — which is the
 * precise failure this feature exists to prevent.
 */
function readBodyLevelFailure(provider: IntegrationProvider, body: string): string | null {
  if (provider !== "telegram" || body.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as { ok?: unknown; description?: unknown };
    if (candidate.ok === false) {
      return typeof candidate.description === "string"
        ? candidate.description
        : "Telegram rejected the message.";
    }
  } catch {
    return null;
  }
  return null;
}

function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_RESPONSE_EXCERPT
    ? `${collapsed.slice(0, MAX_RESPONSE_EXCERPT)}…`
    : collapsed;
}

/**
 * Sends one payload and reports what happened.
 *
 * Never throws: a failed delivery is a result, not an exception. The integration
 * page needs to render the failure, and an unhandled rejection here would take
 * down the route that was only ever asked to report an outcome.
 */
export async function deliverWebhook(request: DeliveryRequest): Promise<DeliveryResult> {
  const startedAt = Date.now();
  const definition = PROVIDERS[request.provider];
  const log = logger.child({ provider: request.provider, component: "webhook-delivery" });

  // Telegram's endpoint embeds the bot token, so the URL that is actually
  // requested is built here — and it is that resolved URL, not the stored one,
  // that has to clear the SSRF guard.
  const endpoint = resolveEndpoint(
    request.provider,
    request.targetUrl,
    request.credential === undefined ? null : { token: request.credential },
  );

  const check = checkWebhookUrl(endpoint, {
    ...(definition.allowedHosts ? { allowedHosts: definition.allowedHosts } : {}),
  });

  if (!check.ok || !check.url) {
    log.warn("Webhook target rejected before send", { reason: check.reason ?? "invalid" });
    return {
      ok: false,
      at: startedAt,
      status: null,
      durationMs: 0,
      detail: check.message ?? "The destination URL was rejected.",
    };
  }

  // The mail relay is a real dependency we do not ship. Say so, rather than
  // reporting a success for a message that never left the building.
  if (request.provider === "email" && !process.env.VORTEX_MAIL_RELAY_URL) {
    log.warn("Mail relay not configured");
    return {
      ok: false,
      at: startedAt,
      status: 503,
      durationMs: Date.now() - startedAt,
      detail:
        "No mail relay configured. Set VORTEX_MAIL_RELAY_URL to enable email delivery — nothing was sent.",
    };
  }

  const payloadOptions = {
    ...(request.credential === undefined ? {} : { credential: request.credential }),
    ...(request.destination === undefined ? {} : { destination: request.destination }),
  };
  const body = JSON.stringify(buildPayload(request.provider, request.notification, payloadOptions));
  const timestamp = Math.floor(startedAt / 1000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "VortexOps-Webhook/1.0",
    [EVENT_HEADER]: request.notification.event,
    [TIMESTAMP_HEADER]: String(timestamp),
  };

  const secret = signingSecret();
  if (definition.signed) {
    if (secret) {
      headers[SIGNATURE_HEADER] = signPayload(body, timestamp, secret);
    } else {
      log.warn("Signing secret missing — sending unsigned", { targetHost: check.url.hostname });
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(check.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      redirect: "manual", // A 302 to a private address would bypass the guard.
      cache: "no-store",
    });

    const durationMs = Date.now() - startedAt;
    const text = await response.text().catch(() => "");

    log.info("Webhook delivered", {
      status: response.status,
      durationMs,
      targetHost: check.url.hostname,
      ok: response.ok,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        at: startedAt,
        status: response.status,
        durationMs,
        detail: "The endpoint redirected. Configure the final URL directly — redirects are not followed.",
      };
    }

    const bodyFailure = response.ok ? readBodyLevelFailure(request.provider, text) : null;

    return {
      ok: response.ok && bodyFailure === null,
      at: startedAt,
      status: response.status,
      durationMs,
      detail: bodyFailure
        ? `The provider accepted the request but rejected the message: ${excerpt(bodyFailure)}`
        : response.ok
          ? `Accepted in ${durationMs} ms.`
          : `Endpoint replied ${response.status}. ${excerpt(text) || "No response body."}`,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const aborted = error instanceof Error && error.name === "AbortError";

    log.exception("Webhook delivery failed", error, {
      durationMs,
      targetHost: check.url.hostname,
      aborted,
    });

    return {
      ok: false,
      at: startedAt,
      status: null,
      durationMs,
      detail: aborted
        ? `No response within ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms. The endpoint timed out.`
        : "Could not reach the endpoint. Check the URL, DNS and any IP allowlist on your side.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
