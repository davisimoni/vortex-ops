import type { IntegrationProvider, WebhookEvent } from "@/types";

/**
 * Provider registry.
 *
 * Adding a destination means adding a row here — auth shape, allowed hosts and
 * the payload dialect are the only three things that differ between providers.
 * Anything that needs a code branch elsewhere belongs in this table instead.
 */

export interface ProviderDefinition {
  readonly id: IntegrationProvider;
  readonly label: string;
  readonly blurb: string;
  /**
   * What the customer must paste in, beyond the URL.
   *
   * `none` — the endpoint URL is itself the credential (Slack, Discord).
   * `token` — a secret sent in the body or the path (PagerDuty routing key,
   * Telegram bot token).
   * `token+destination` — a secret plus a channel identifier (Telegram: bot
   * token and chat id).
   */
  readonly credential: "none" | "token" | "token+destination";
  /** Field labels for whichever credential inputs this provider needs. */
  readonly credentialLabels?: {
    readonly token?: string;
    readonly tokenHint?: string;
    readonly destination?: string;
    readonly destinationHint?: string;
  };
  /**
   * `true` when the endpoint is derived from the credential rather than typed.
   * Telegram's real URL embeds the bot token, so the URL field is hidden.
   */
  readonly derivesUrl?: boolean;
  /**
   * Hosts this provider's endpoints live on. Enforced at save time *and* again
   * at delivery — a `null` means any public host is acceptable (generic webhook).
   */
  readonly allowedHosts: readonly string[] | null;
  /** Whether we attach an HMAC signature header. */
  readonly signed: boolean;
  /** Placeholder shown in the URL field. */
  readonly placeholder: string;
  /** What the customer has to fetch from the provider before this works. */
  readonly setupHint: string;
  /**
   * `false` means the payload shape is written to the provider's public spec but
   * has not been verified against a live account. The UI shows this as a badge:
   * an integration that looks configured and silently does not deliver is worse
   * than one that is visibly missing, because nobody goes back to check it.
   */
  readonly verified: boolean;
}

export const PROVIDERS: Record<IntegrationProvider, ProviderDefinition> = {
  slack: {
    id: "slack",
    label: "Slack",
    blurb: "Posts a formatted incident card into a channel via an incoming webhook.",
    allowedHosts: ["hooks.slack.com"],
    signed: false,
    credential: "none",
    placeholder: "https://hooks.slack.com/services/T000/B000/XXXX",
    setupHint: "Slack → Apps → Incoming Webhooks → Add to workspace, then copy the webhook URL.",
    verified: true,
  },
  discord: {
    id: "discord",
    label: "Discord",
    blurb: "Posts a colour-coded incident embed into a channel via a channel webhook.",
    // Discord serves webhooks from several hostnames; all of them are theirs.
    allowedHosts: ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"],
    signed: false,
    credential: "none",
    placeholder: "https://discord.com/api/webhooks/123456789012345678/AbCdEf-token",
    setupHint:
      "Discord → Server Settings → Integrations → Webhooks → New Webhook, then Copy Webhook URL. The URL is the credential: anyone holding it can post to that channel.",
    verified: true,
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    blurb: "Sends the incident to a chat, group or channel through a bot.",
    allowedHosts: ["api.telegram.org"],
    signed: false,
    credential: "token+destination",
    credentialLabels: {
      token: "Bot token",
      tokenHint:
        "From @BotFather, in the form 123456789:AA…. Stored encrypted and never returned to the browser.",
      destination: "Chat ID",
      destinationHint:
        "Numeric id, or @channelusername. Message @userinfobot, or read it from getUpdates after messaging your bot.",
    },
    // The real endpoint embeds the bot token, so it is built server-side from
    // the stored credential rather than typed into a field that would then
    // display a secret in plain text.
    derivesUrl: true,
    placeholder: "https://api.telegram.org",
    setupHint:
      "Create a bot with @BotFather, add it to the target chat, and give it permission to post. A bot cannot message a user who has never messaged it first.",
    verified: true,
  },
  pagerduty: {
    id: "pagerduty",
    label: "PagerDuty",
    blurb: "Triggers an Events API v2 alert with a stable dedup key per incident.",
    allowedHosts: ["events.pagerduty.com", "events.eu.pagerduty.com"],
    signed: false,
    credential: "token",
    credentialLabels: {
      token: "Routing key",
      tokenHint: "Stored encrypted at rest and never returned to the browser.",
    },
    placeholder: "https://events.eu.pagerduty.com/v2/enqueue",
    setupHint:
      "PagerDuty → Service → Integrations → Events API v2. The routing key goes in the secret field.",
    verified: true,
  },
  email: {
    id: "email",
    label: "Email",
    blurb: "Sends the incident digest to a distribution list through the transactional relay.",
    allowedHosts: null,
    signed: false,
    credential: "token+destination",
    credentialLabels: {
      token: "Relay API key",
      destination: "Recipients",
      destinationHint: "Comma-separated addresses for the digest.",
    },
    placeholder: "https://relay.example.com/v1/send",
    setupHint:
      "Requires an outbound mail relay. Without VORTEX_MAIL_RELAY_URL configured, test sends return 503 rather than reporting a success that never left the building.",
    verified: false,
  },
  webhook: {
    id: "webhook",
    label: "Custom webhook",
    blurb: "Raw JSON to any HTTPS endpoint, signed with HMAC-SHA256.",
    allowedHosts: null,
    signed: true,
    credential: "none",
    placeholder: "https://ops.your-company.com/hooks/vortex",
    setupHint:
      "Verify X-Vortex-Signature against your shared secret before trusting a request. An unsigned webhook is a public API that accepts fake incidents from anyone.",
    verified: true,
  },
};

export const PROVIDER_IDS: readonly IntegrationProvider[] = [
  "slack",
  "discord",
  "telegram",
  "pagerduty",
  "email",
  "webhook",
] as const;

/**
 * Builds the endpoint a request actually goes to.
 *
 * Telegram's URL embeds the bot token (`/bot<token>/sendMessage`), so it is
 * assembled here from the decrypted credential rather than stored — a stored
 * URL would put the secret in a column that the UI displays.
 */
export function resolveEndpoint(
  provider: IntegrationProvider,
  targetUrl: string,
  credential: { token?: string } | null,
): string {
  if (provider !== "telegram") return targetUrl;
  const token = credential?.token?.trim();
  if (!token) return targetUrl;
  return `https://api.telegram.org/bot${token}/sendMessage`;
}

export function isProvider(value: string): value is IntegrationProvider {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  "incident.opened",
  "incident.status_changed",
  "incident.assigned",
  "incident.resolved",
  "alert.triggered",
] as const;

export const EVENT_LABEL: Record<WebhookEvent, string> = {
  "incident.opened": "Incident opened",
  "incident.status_changed": "Status changed",
  "incident.assigned": "Responder assigned",
  "incident.resolved": "Incident resolved",
  "alert.triggered": "Alert rule triggered",
};

export const EVENT_DESCRIPTION: Record<WebhookEvent, string> = {
  "incident.opened": "A new incident was declared, manually or by an alert rule.",
  "incident.status_changed": "An incident moved between investigating, identified and monitoring.",
  "incident.assigned": "An incident was assigned to, or reassigned between, responders.",
  "incident.resolved": "An incident reached the resolved state.",
  "alert.triggered": "A threshold rule breached its dwell time, before any incident is opened.",
};

/** Signature header name. Kept here so the docs snippet and the sender agree. */
export const SIGNATURE_HEADER = "X-Vortex-Signature";
export const TIMESTAMP_HEADER = "X-Vortex-Timestamp";
export const EVENT_HEADER = "X-Vortex-Event";
