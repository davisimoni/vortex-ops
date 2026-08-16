import { SEVERITY_LABEL, STATUS_LABEL } from "@/lib/incidents";
import { serviceName } from "@/lib/services";
import type { Incident, IncidentSeverity, IncidentStatus, IntegrationProvider, WebhookEvent } from "@/types";

/**
 * Payload builders — one dialect per provider, no I/O.
 *
 * Isomorphic on purpose: the integrations page renders the exact bytes the
 * server will send as a preview, so what the customer reviews and what leaves
 * the building are produced by the same function.
 */

export interface IncidentNotification {
  readonly event: WebhookEvent;
  readonly incidentId: string;
  readonly title: string;
  readonly summary: string;
  readonly serviceId: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly assignee: string | null;
  readonly startedAt: number;
  readonly dashboardUrl: string;
  /** True for the "send test payload" button. Never omitted on a test send. */
  readonly test: boolean;
}

/**
 * A recognisably fake incident.
 *
 * The `TEST —` prefix is not decoration. This payload lands in the same channel
 * as real pages, and somebody will forward it: without the marker, a test send
 * gets a human out of bed at 3am for an outage that is not happening.
 */
export function sampleNotification(event: WebhookEvent = "incident.opened"): IncidentNotification {
  return {
    event,
    incidentId: "INC-0000-TEST",
    title: "TEST — CRITICAL: Latency Spike Detected",
    summary:
      "TEST PAYLOAD from Vortex Ops. No live incident is in progress. " +
      "p99 latency held above the 900 ms threshold for 4 consecutive samples on API Gateway.",
    serviceId: "api-gateway",
    severity: "critical",
    status: "investigating",
    assignee: "TEST — unassigned",
    startedAt: 0,
    dashboardUrl: "https://vortex-ops.example.com/incidents/INC-0000-TEST",
    test: true,
  };
}

export interface NotificationOptions {
  /** Display name of the assignee. Omit or pass `null` for unassigned. */
  readonly assigneeName?: string | null;
  readonly dashboardUrl?: string;
  /** See `IncidentNotification.test`. Defaults to `false` — a real event. */
  readonly test?: boolean;
}

/**
 * Builds the notification for a real, persisted incident.
 *
 * Separate from `sampleNotification`: that one fabricates an entire fake
 * incident for the "send test payload" button. This one carries an incident
 * that actually exists — the caller resolves the assignee's display name
 * first, since this module has no access to team lookups and stays pure.
 */
export function notificationFromIncident(
  incident: Pick<Incident, "id" | "title" | "summary" | "serviceId" | "severity" | "status" | "startedAt">,
  event: WebhookEvent,
  options: NotificationOptions = {},
): IncidentNotification {
  return {
    event,
    incidentId: incident.id,
    title: incident.title,
    summary: incident.summary,
    serviceId: incident.serviceId,
    severity: incident.severity,
    status: incident.status,
    assignee: options.assigneeName ?? null,
    startedAt: incident.startedAt,
    dashboardUrl: options.dashboardUrl ?? `https://vortex-ops.example.com/incidents/${incident.id}`,
    test: options.test ?? false,
  };
}

/** PagerDuty's severity vocabulary differs from ours; map explicitly. */
const PAGERDUTY_SEVERITY: Record<IncidentSeverity, "critical" | "error" | "warning"> = {
  critical: "critical",
  major: "error",
  warning: "warning",
};

const SLACK_EMOJI: Record<IncidentSeverity, string> = {
  critical: ":rotating_light:",
  major: ":warning:",
  warning: ":large_yellow_circle:",
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isoOrNull(timestamp: number): string | null {
  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function buildSlackPayload(notification: IncidentNotification): JsonValue {
  const headline = `${SLACK_EMOJI[notification.severity]} *${notification.title}*`;
  return {
    text: `${SEVERITY_LABEL[notification.severity]}: ${notification.title}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: headline } },
      { type: "section", text: { type: "mrkdwn", text: notification.summary } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Service*\n${serviceName(notification.serviceId)}` },
          { type: "mrkdwn", text: `*Severity*\n${SEVERITY_LABEL[notification.severity]}` },
          { type: "mrkdwn", text: `*Status*\n${STATUS_LABEL[notification.status]}` },
          { type: "mrkdwn", text: `*Responder*\n${notification.assignee ?? "Unassigned"}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open in Vortex Ops" },
            url: notification.dashboardUrl,
          },
        ],
      },
    ],
  };
}

function buildPagerDutyPayload(notification: IncidentNotification, routingKey: string): JsonValue {
  return {
    routing_key: routingKey,
    // Same key for the whole incident lifecycle, so a resolve closes the alert
    // it opened instead of stacking duplicates.
    dedup_key: notification.incidentId,
    event_action: notification.event === "incident.resolved" ? "resolve" : "trigger",
    client: "Vortex Ops",
    client_url: notification.dashboardUrl,
    payload: {
      summary: notification.title,
      severity: PAGERDUTY_SEVERITY[notification.severity],
      source: serviceName(notification.serviceId),
      component: notification.serviceId,
      group: "vortex-ops",
      class: notification.event,
      timestamp: isoOrNull(notification.startedAt),
      custom_details: {
        summary: notification.summary,
        status: notification.status,
        assignee: notification.assignee,
        test: notification.test,
      },
    },
  };
}

function buildEmailPayload(notification: IncidentNotification, recipients: string): JsonValue {
  const subjectPrefix = notification.test ? "[TEST] " : "";
  return {
    to: recipients,
    subject: `${subjectPrefix}[${SEVERITY_LABEL[notification.severity]}] ${notification.title}`,
    body: [
      notification.summary,
      "",
      `Service:   ${serviceName(notification.serviceId)}`,
      `Severity:  ${SEVERITY_LABEL[notification.severity]}`,
      `Status:    ${STATUS_LABEL[notification.status]}`,
      `Responder: ${notification.assignee ?? "Unassigned"}`,
      "",
      notification.dashboardUrl,
    ].join("\n"),
    metadata: { event: notification.event, incidentId: notification.incidentId },
  };
}

/**
 * Discord embed colours are a single integer, not a CSS string.
 * These are the reserved status palette steps, so severity reads the same way
 * in Discord as it does in the product.
 */
const DISCORD_COLOR: Record<IncidentSeverity, number> = {
  critical: 0xd0_3b_3b,
  major: 0xec_83_5a,
  warning: 0xfa_b2_19,
};

function buildDiscordPayload(notification: IncidentNotification): JsonValue {
  return {
    username: "Vortex Ops",
    // `content` is what a push notification and a screen reader announce; an
    // embed alone arrives as an empty notification on mobile.
    content: `${SEVERITY_LABEL[notification.severity]}: ${notification.title}`,
    embeds: [
      {
        title: notification.title,
        description: notification.summary,
        url: notification.dashboardUrl,
        color: DISCORD_COLOR[notification.severity],
        timestamp: notification.startedAt > 0 ? new Date(notification.startedAt).toISOString() : null,
        fields: [
          { name: "Service", value: serviceName(notification.serviceId), inline: true },
          { name: "Severity", value: SEVERITY_LABEL[notification.severity], inline: true },
          { name: "Status", value: STATUS_LABEL[notification.status], inline: true },
          { name: "Responder", value: notification.assignee ?? "Unassigned", inline: true },
        ],
        footer: { text: notification.test ? "Test payload — no live incident" : "Vortex Ops" },
      },
    ],
  };
}

/**
 * Telegram in HTML mode.
 *
 * Incident titles and summaries are operator-written text that can contain
 * `<`, `>` and `&`. Unescaped, Telegram rejects the whole message with
 * "can't parse entities" — so a real incident silently fails to page anyone
 * because someone typed `latency > 900ms`.
 */
function escapeTelegramHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const TELEGRAM_ICON: Record<IncidentSeverity, string> = {
  critical: "🔴",
  major: "🟠",
  warning: "🟡",
};

function buildTelegramPayload(notification: IncidentNotification, chatId: string): JsonValue {
  const lines = [
    `${TELEGRAM_ICON[notification.severity]} <b>${escapeTelegramHtml(notification.title)}</b>`,
    "",
    escapeTelegramHtml(notification.summary),
    "",
    `<b>Service:</b> ${escapeTelegramHtml(serviceName(notification.serviceId))}`,
    `<b>Severity:</b> ${SEVERITY_LABEL[notification.severity]}`,
    `<b>Status:</b> ${STATUS_LABEL[notification.status]}`,
    `<b>Responder:</b> ${escapeTelegramHtml(notification.assignee ?? "Unassigned")}`,
  ];

  return {
    chat_id: chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    // The dashboard URL is internal; a link preview attempt just adds latency.
    disable_web_page_preview: true,
  };
}

function buildGenericPayload(notification: IncidentNotification): JsonValue {
  return {
    id: `evt_${notification.incidentId.toLowerCase()}`,
    type: notification.event,
    created_at: new Date(0).toISOString(),
    test: notification.test,
    data: {
      incident: {
        id: notification.incidentId,
        title: notification.title,
        summary: notification.summary,
        severity: notification.severity,
        status: notification.status,
        service: { id: notification.serviceId, name: serviceName(notification.serviceId) },
        assignee: notification.assignee,
        started_at: isoOrNull(notification.startedAt),
        url: notification.dashboardUrl,
      },
    },
  };
}

export interface PayloadOptions {
  /** PagerDuty routing key, Telegram bot token, or the email relay key. */
  readonly credential?: string;
  /** Telegram chat id, or the recipient list for email. */
  readonly destination?: string;
  /** Stamps the real send time. Left at 0 for previews so they stay stable. */
  readonly now?: number;
}

export function buildPayload(
  provider: IntegrationProvider,
  notification: IncidentNotification,
  options: PayloadOptions = {},
): JsonValue {
  const stamped: IncidentNotification =
    options.now === undefined ? notification : { ...notification, startedAt: options.now };

  switch (provider) {
    case "slack":
      return buildSlackPayload(stamped);
    case "discord":
      return buildDiscordPayload(stamped);
    case "telegram":
      return buildTelegramPayload(stamped, options.destination ?? "<chat_id>");
    case "pagerduty":
      return buildPagerDutyPayload(stamped, options.credential ?? "<routing_key>");
    case "email":
      return buildEmailPayload(stamped, options.destination ?? "oncall@your-company.com");
    case "webhook":
      return buildGenericPayload(stamped);
    default: {
      // Exhaustiveness: adding a provider without a builder is a compile error.
      const unreachable: never = provider;
      throw new Error(`No payload builder for provider: ${String(unreachable)}`);
    }
  }
}

/** Pretty-printed preview of the exact object the sender serialises. */
export function previewPayload(
  provider: IntegrationProvider,
  notification: IncidentNotification,
  options: PayloadOptions = {},
): string {
  return JSON.stringify(buildPayload(provider, notification, options), null, 2);
}
