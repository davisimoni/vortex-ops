import { describe, expect, it } from "vitest";

import { signPayload, verifySignature } from "@/lib/webhooks/delivery";
import {
  buildPayload,
  notificationFromIncident,
  previewPayload,
  sampleNotification,
  type JsonValue,
} from "@/lib/webhooks/payloads";
import {
  isProvider,
  PROVIDER_IDS,
  PROVIDERS,
  resolveEndpoint,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks/providers";

function asRecord(value: JsonValue): Record<string, JsonValue> {
  expect(typeof value).toBe("object");
  return value as Record<string, JsonValue>;
}

describe("provider registry", () => {
  it("defines every provider referenced by the id list", () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id]).toBeDefined();
      expect(PROVIDERS[id].label).toBeTruthy();
      expect(PROVIDERS[id].placeholder).toMatch(/^https:\/\//);
    }
  });

  it("constrains the hosts of providers with known endpoints", () => {
    expect(PROVIDERS.slack.allowedHosts).toContain("hooks.slack.com");
    expect(PROVIDERS.pagerduty.allowedHosts).toContain("events.pagerduty.com");
    // A custom webhook can point anywhere public, by definition.
    expect(PROVIDERS.webhook.allowedHosts).toBeNull();
  });

  it("signs only the provider whose contract we control", () => {
    expect(PROVIDERS.webhook.signed).toBe(true);
    expect(PROVIDERS.slack.signed).toBe(false);
  });

  it("narrows unknown strings", () => {
    expect(isProvider("slack")).toBe(true);
    expect(isProvider("discord")).toBe(true);
    expect(isProvider("telegram")).toBe(true);
    expect(isProvider("teams")).toBe(false);
  });

  it("declares what credential each provider needs", () => {
    expect(PROVIDERS.slack.credential).toBe("none");
    expect(PROVIDERS.discord.credential).toBe("none");
    expect(PROVIDERS.pagerduty.credential).toBe("token");
    expect(PROVIDERS.telegram.credential).toBe("token+destination");
    expect(PROVIDERS.email.credential).toBe("token+destination");
  });

  it("constrains Discord to its own hosts and Telegram to the Bot API host", () => {
    expect(PROVIDERS.discord.allowedHosts).toContain("discord.com");
    expect(PROVIDERS.telegram.allowedHosts).toEqual(["api.telegram.org"]);
  });

  it("marks only Telegram as deriving its endpoint from the credential", () => {
    for (const id of PROVIDER_IDS) {
      expect(Boolean(PROVIDERS[id].derivesUrl)).toBe(id === "telegram");
    }
  });
});

describe("resolveEndpoint", () => {
  it("passes non-Telegram URLs through unchanged", () => {
    expect(resolveEndpoint("slack", "https://hooks.slack.com/services/T/B/X", null)).toBe(
      "https://hooks.slack.com/services/T/B/X",
    );
    expect(resolveEndpoint("webhook", "https://ops.example.com/hook", { token: "ignored" })).toBe(
      "https://ops.example.com/hook",
    );
  });

  it("builds the Telegram Bot API URL from the stored token", () => {
    expect(resolveEndpoint("telegram", "https://api.telegram.org", { token: "123456:AA-secret" })).toBe(
      "https://api.telegram.org/bot123456:AA-secret/sendMessage",
    );
  });

  it("falls back to the stored URL when Telegram has no credential yet", () => {
    expect(resolveEndpoint("telegram", "https://api.telegram.org", null)).toBe(
      "https://api.telegram.org",
    );
  });
});

describe("buildPayload", () => {
  it("produces a Slack blocks payload with a fallback text field", () => {
    const payload = asRecord(buildPayload("slack", sampleNotification()));
    // `text` is what a notification preview and a screen reader use; blocks
    // alone render as an empty push notification.
    expect(typeof payload.text).toBe("string");
    expect(Array.isArray(payload.blocks)).toBe(true);
  });

  it("uses the incident id as the PagerDuty dedup key", () => {
    const payload = asRecord(buildPayload("pagerduty", sampleNotification(), { credential: "R0KEY" }));
    expect(payload.routing_key).toBe("R0KEY");
    expect(payload.dedup_key).toBe("INC-0000-TEST");
    expect(payload.event_action).toBe("trigger");
  });

  it("switches PagerDuty to resolve on a resolution event, so alerts close instead of stacking", () => {
    const payload = asRecord(
      buildPayload("pagerduty", sampleNotification("incident.resolved"), { credential: "K" }),
    );
    expect(payload.event_action).toBe("resolve");
  });

  it("maps our severities onto PagerDuty's vocabulary", () => {
    const payload = asRecord(buildPayload("pagerduty", sampleNotification(), { credential: "K" }));
    const inner = asRecord(payload.payload as JsonValue);
    expect(inner.severity).toBe("critical");
  });

  it("marks a test email in the subject line", () => {
    // Email's recipient list is a `destination`, not a `credential` — the
    // relay API key (if any) is the credential; who receives the mail is not
    // a secret.
    const payload = asRecord(buildPayload("email", sampleNotification(), { destination: "a@b.test" }));
    expect(String(payload.subject).startsWith("[TEST]")).toBe(true);
    expect(payload.to).toBe("a@b.test");
  });

  it("wraps the generic webhook payload in a typed envelope", () => {
    const payload = asRecord(buildPayload("webhook", sampleNotification()));
    expect(payload.type).toBe("incident.opened");
    expect(payload.test).toBe(true);
    const data = asRecord(payload.data as JsonValue);
    const incident = asRecord(data.incident as JsonValue);
    expect(incident.id).toBe("INC-0000-TEST");
    expect(asRecord(incident.service as JsonValue).name).toBe("API Gateway");
  });

  it("produces a Discord embed with a fallback content field and a severity colour", () => {
    const payload = asRecord(buildPayload("discord", sampleNotification()));
    expect(typeof payload.content).toBe("string");

    const embeds = payload.embeds as JsonValue[];
    expect(Array.isArray(embeds)).toBe(true);
    const embed = asRecord(embeds[0] as JsonValue);
    expect(embed.title).toContain("TEST");
    // The reserved status-critical token, not a categorical series colour.
    expect(embed.color).toBe(0xd0_3b_3b);
  });

  it("varies the Discord embed colour by severity", () => {
    const embedFor = (severity: "critical" | "major" | "warning"): number => {
      const notification = { ...sampleNotification(), severity };
      const embeds = asRecord(buildPayload("discord", notification)).embeds as JsonValue[];
      return Number(asRecord(embeds[0] as JsonValue).color);
    };

    const colours = new Set([embedFor("critical"), embedFor("major"), embedFor("warning")]);
    expect(colours.size).toBe(3);
  });

  it("builds a Telegram message in HTML parse mode with the chat id", () => {
    const payload = asRecord(
      buildPayload("telegram", sampleNotification(), { destination: "-100123456789" }),
    );
    expect(payload.chat_id).toBe("-100123456789");
    expect(payload.parse_mode).toBe("HTML");
    expect(String(payload.text)).toContain("<b>");
  });

  it("escapes HTML-significant characters in Telegram text, or the send fails", () => {
    // Telegram's HTML parser rejects the whole message on an unescaped `<`,
    // `>` or `&` — a real incident with ">" in its summary must still send.
    const notification = {
      ...sampleNotification(),
      summary: "latency > 900ms & rising <fast>",
    };
    const payload = asRecord(buildPayload("telegram", notification, { destination: "1" }));
    const text = String(payload.text);

    expect(text).toContain("&gt;");
    expect(text).toContain("&amp;");
    expect(text).toContain("&lt;fast&gt;");
    expect(text).not.toMatch(/[^&]<fast>/);
  });

  it("builds a payload for every provider and event without throwing", () => {
    for (const provider of PROVIDER_IDS) {
      for (const event of WEBHOOK_EVENTS) {
        expect(() => buildPayload(provider, sampleNotification(event))).not.toThrow();
      }
    }
  });
});

describe("sampleNotification", () => {
  it("is unmistakably a test", () => {
    // Somebody will forward this to a channel. It must never read as a real
    // outage, or an engineer gets out of bed for a button click.
    const sample = sampleNotification();
    expect(sample.test).toBe(true);
    expect(sample.title).toContain("TEST");
    expect(sample.summary).toContain("TEST PAYLOAD");
  });
});

describe("notificationFromIncident", () => {
  const incident = {
    id: "INC-9001",
    title: "CHAOS DRILL — Simulated failure on API Gateway",
    summary: "Synthetic 500-error spike.",
    serviceId: "api-gateway",
    severity: "critical" as const,
    status: "investigating" as const,
    startedAt: 1_700_000_000_000,
  };

  it("carries the real incident's fields through untouched", () => {
    const notification = notificationFromIncident(incident, "incident.opened");
    expect(notification.incidentId).toBe(incident.id);
    expect(notification.title).toBe(incident.title);
    expect(notification.severity).toBe("critical");
    expect(notification.startedAt).toBe(incident.startedAt);
  });

  it("defaults to a real, non-test event when no options are given", () => {
    expect(notificationFromIncident(incident, "incident.opened").test).toBe(false);
  });

  it("honours an explicit test flag, for events that are real rows but not real outages", () => {
    const notification = notificationFromIncident(incident, "incident.opened", { test: true });
    expect(notification.test).toBe(true);
  });

  it("leaves the assignee unset unless a display name is supplied", () => {
    expect(notificationFromIncident(incident, "incident.opened").assignee).toBeNull();
    expect(
      notificationFromIncident(incident, "incident.opened", { assigneeName: "Priya Raman" }).assignee,
    ).toBe("Priya Raman");
  });

  it("builds a dashboard URL from the incident id when none is supplied", () => {
    expect(notificationFromIncident(incident, "incident.opened").dashboardUrl).toContain(incident.id);
  });
});

describe("previewPayload", () => {
  it("renders the same object the sender serialises", () => {
    const preview = previewPayload("webhook", sampleNotification());
    expect(JSON.parse(preview)).toEqual(buildPayload("webhook", sampleNotification()));
  });
});

describe("HMAC signing", () => {
  const secret = "a-secret-at-least-sixteen-chars";
  const body = JSON.stringify({ hello: "world" });

  it("produces a versioned hex signature", () => {
    expect(signPayload(body, 1_700_000_000, secret)).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    expect(signPayload(body, 1_700_000_000, secret)).toBe(signPayload(body, 1_700_000_000, secret));
  });

  it("changes when the body changes", () => {
    expect(signPayload(body, 1_700_000_000, secret)).not.toBe(
      signPayload(`${body} `, 1_700_000_000, secret),
    );
  });

  it("changes when the timestamp changes, which is what defeats a replay", () => {
    expect(signPayload(body, 1_700_000_000, secret)).not.toBe(
      signPayload(body, 1_700_000_001, secret),
    );
  });

  it("verifies a matching signature and rejects everything else", () => {
    const timestamp = 1_700_000_000;
    const signature = signPayload(body, timestamp, secret);

    expect(verifySignature(body, timestamp, secret, signature)).toBe(true);
    expect(verifySignature(body, timestamp, "different-secret-value", signature)).toBe(false);
    expect(verifySignature(`${body}x`, timestamp, secret, signature)).toBe(false);
    expect(verifySignature(body, timestamp + 1, secret, signature)).toBe(false);
    expect(verifySignature(body, timestamp, secret, "v1=short")).toBe(false);
  });
});
