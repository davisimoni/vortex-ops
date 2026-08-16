import { meetsMinimumSeverity } from "@/lib/incidents";
import { logger } from "@/lib/logger";
import { deliverWebhook } from "@/lib/webhooks/delivery";
import type { IncidentNotification } from "@/lib/webhooks/payloads";
import { CryptoUnavailableError } from "@/server/crypto/secrets";
import { getRepository } from "@/server/repository";
import type { Integration } from "@/types";

/**
 * Notification fan-out to every integration subscribed to one event.
 *
 * This is the same delivery path `/api/integrations/trigger` uses for a
 * single, operator-chosen integration — this module is the "fire automatically,
 * to everything that's listening" counterpart, used by server-initiated events
 * (today: the chaos drill) rather than a person clicking "Send test payload".
 */

/** Pure filter: enabled, subscribed to this event, and at or above the configured minimum severity. */
export function selectNotifiableIntegrations(
  integrations: readonly Integration[],
  notification: Pick<IncidentNotification, "event" | "severity">,
): Integration[] {
  return integrations.filter(
    (integration) =>
      integration.enabled &&
      integration.events.includes(notification.event) &&
      meetsMinimumSeverity(notification.severity, integration.minSeverity),
  );
}

/**
 * Fires a real notification to every matching integration in one organisation.
 *
 * Best-effort and non-blocking by design: a customer's endpoint being down, or
 * an unreadable credential, must never fail the incident mutation that
 * triggered the notification. Every failure is caught and logged; none is
 * rethrown.
 */
export async function notifyIntegrations(
  orgId: string,
  notification: IncidentNotification,
): Promise<void> {
  const repository = await getRepository();
  const log = logger.child({ component: "notifications", orgId });

  let integrations: readonly Integration[];
  try {
    integrations = await repository.listIntegrations(orgId);
  } catch (error) {
    log.exception("Could not list integrations for notification fan-out", error);
    return;
  }

  const targets = selectNotifiableIntegrations(integrations, notification);
  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (integration) => {
      try {
        const record = await repository.getIntegrationWithCredential(orgId, integration.id);
        if (!record) return;

        const { credential } = record;
        const result = await deliverWebhook({
          provider: integration.provider,
          targetUrl: integration.targetUrl,
          notification,
          ...(credential?.token ? { credential: credential.token } : {}),
          ...(credential?.destination ? { destination: credential.destination } : {}),
        });

        await repository.recordDelivery(orgId, integration.id, result);
      } catch (error) {
        if (error instanceof CryptoUnavailableError) {
          log.warn("Skipped notification — stored credential could not be decrypted", {
            integrationId: integration.id,
          });
          return;
        }
        log.exception("Notification delivery failed unexpectedly", error, {
          integrationId: integration.id,
        });
      }
    }),
  );
}
