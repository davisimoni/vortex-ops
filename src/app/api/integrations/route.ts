import { checkWebhookUrl } from "@/lib/net/safe-url";
import { PROVIDERS } from "@/lib/webhooks/providers";
import { recordAudit } from "@/server/audit";
import { CryptoUnavailableError, isEncryptionAvailable } from "@/server/crypto/secrets";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import type { CredentialBundle } from "@/server/repository/types";
import { requirePermission } from "@/server/session/context";
import { integrationDraftSchema } from "@/server/validation";
import type { IncidentSeverity, IntegrationProvider, WebhookEvent } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validates a destination against the provider's rules.
 *
 * Telegram is the exception: its endpoint is derived from the bot token at send
 * time, so there is no URL for the customer to type and nothing to check here.
 * The derived URL is still run through the same guard immediately before the
 * request goes out.
 */
export function validateDestination(
  provider: IntegrationProvider,
  targetUrl: string,
): { ok: true } | { ok: false; message: string } {
  const definition = PROVIDERS[provider];
  if (definition.derivesUrl) return { ok: true };

  const check = checkWebhookUrl(targetUrl, {
    ...(definition.allowedHosts ? { allowedHosts: definition.allowedHosts } : {}),
  });

  return check.ok ? { ok: true } : { ok: false, message: check.message ?? "That URL is not valid." };
}

function toCredentialBundle(
  input: { token?: string; destination?: string } | null | undefined,
): CredentialBundle | null {
  if (!input) return null;
  const token = input.token?.trim();
  const destination = input.destination?.trim();
  if (!token && !destination) return null;
  return {
    ...(token ? { token } : {}),
    ...(destination ? { destination } : {}),
  };
}

export const GET = route("/api/integrations", async () => {
  const session = await requirePermission("integration:read");
  const repository = await getRepository();
  const integrations = await repository.listIntegrations(session.organization.id);
  // `listIntegrations` returns the public shape: no ciphertext, no plaintext,
  // only the masked hint.
  return jsonOk({ integrations });
});

export const POST = route("/api/integrations", async (request) => {
  const session = await requirePermission("integration:manage");

  const body = await readJsonBody(request, integrationDraftSchema);
  if (!body.ok) return body.response;

  const provider = body.data.provider as IntegrationProvider;
  const definition = PROVIDERS[provider];

  const destination = validateDestination(provider, body.data.targetUrl);
  if (!destination.ok) return jsonError("invalid_destination", destination.message, 422);

  const credential = toCredentialBundle(body.data.credential);

  if (definition.credential !== "none" && !credential?.token) {
    return jsonError(
      "credential_required",
      `${definition.label} needs a ${definition.credentialLabels?.token ?? "credential"} before it can deliver anything.`,
      422,
    );
  }

  if (credential && !isEncryptionAvailable()) {
    // Refusing beats storing a bot token in plaintext. The 503 says what to do.
    return jsonError(
      "encryption_unavailable",
      "Credentials cannot be stored: no encryption key is configured. Set VORTEX_ENCRYPTION_KEY (or a 32+ character VORTEX_SESSION_SECRET) and try again.",
      503,
    );
  }

  const repository = await getRepository();

  try {
    const integration = await repository.createIntegration(
      session.organization.id,
      {
        provider,
        name: body.data.name,
        targetUrl: body.data.targetUrl,
        enabled: body.data.enabled,
        events: body.data.events as WebhookEvent[],
        minSeverity: body.data.minSeverity as IncidentSeverity,
      },
      credential,
    );

    await recordAudit(
      session,
      {
        action: "integration.create",
        targetType: "integration",
        targetId: integration.id,
        // The target host, never the URL: a Slack or Discord webhook URL *is*
        // the credential, and this table is never deleted.
        metadata: { provider, hasCredential: credential !== null },
      },
      request,
    );

    return jsonOk({ integration }, { status: 201 });
  } catch (error) {
    if (error instanceof CryptoUnavailableError) {
      return jsonError("encryption_unavailable", error.message, 503);
    }
    throw error;
  }
});
