import { PROVIDERS } from "@/lib/webhooks/providers";
import { validateDestination } from "@/app/api/integrations/route";
import { recordAudit } from "@/server/audit";
import { CryptoUnavailableError, isEncryptionAvailable } from "@/server/crypto/secrets";
import { jsonError, jsonOk, readJsonBody, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import type { CredentialBundle } from "@/server/repository/types";
import { requirePermission } from "@/server/session/context";
import { integrationPatchSchema } from "@/server/validation";
import type { IncidentSeverity, IntegrationProvider, WebhookEvent } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toCredentialBundle(
  input: { token?: string; destination?: string } | null | undefined,
): CredentialBundle | null {
  if (!input) return null;
  const token = input.token?.trim();
  const destination = input.destination?.trim();
  if (!token && !destination) return null;
  return { ...(token ? { token } : {}), ...(destination ? { destination } : {}) };
}

export const PATCH = route("/api/integrations/[id]", async (request, context) => {
  const session = await requirePermission("integration:manage");
  const { id } = await context.params;
  const integrationId = id ?? "";

  const body = await readJsonBody(request, integrationPatchSchema);
  if (!body.ok) return body.response;

  const repository = await getRepository();
  const current = await repository.getIntegration(session.organization.id, integrationId);
  if (!current) return jsonError("not_found", "No such integration in this organisation.", 404);

  const provider = (body.data.provider ?? current.provider) as IntegrationProvider;
  const targetUrl = body.data.targetUrl ?? current.targetUrl;

  // Re-validated on every edit, not only at creation. An update that skipped
  // the check would be a way to smuggle a private address past the guard.
  const destination = validateDestination(provider, targetUrl);
  if (!destination.ok) return jsonError("invalid_destination", destination.message, 422);

  const credential = toCredentialBundle(body.data.credential);

  // Changing provider can introduce a credential requirement the record does
  // not yet satisfy.
  const definition = PROVIDERS[provider];
  const willHaveCredential = credential !== null || current.credentialHint !== null;
  if (definition.credential !== "none" && !willHaveCredential) {
    return jsonError(
      "credential_required",
      `${definition.label} needs a ${definition.credentialLabels?.token ?? "credential"} before it can deliver anything.`,
      422,
    );
  }

  if (credential && !isEncryptionAvailable()) {
    return jsonError(
      "encryption_unavailable",
      "Credentials cannot be stored: no encryption key is configured.",
      503,
    );
  }

  try {
    const integration = await repository.updateIntegration(
      session.organization.id,
      integrationId,
      {
        provider,
        ...(body.data.name === undefined ? {} : { name: body.data.name }),
        targetUrl,
        ...(body.data.enabled === undefined ? {} : { enabled: body.data.enabled }),
        ...(body.data.events === undefined ? {} : { events: body.data.events as WebhookEvent[] }),
        ...(body.data.minSeverity === undefined
          ? {}
          : { minSeverity: body.data.minSeverity as IncidentSeverity }),
      },
      credential,
    );

    await recordAudit(
      session,
      {
        action: "integration.update",
        targetType: "integration",
        targetId: integrationId,
        metadata: {
          provider,
          credentialRotated: credential !== null,
          enabled: body.data.enabled ?? current.enabled,
        },
      },
      request,
    );

    return jsonOk({ integration });
  } catch (error) {
    if (error instanceof CryptoUnavailableError) {
      return jsonError("encryption_unavailable", error.message, 503);
    }
    throw error;
  }
});

export const DELETE = route("/api/integrations/[id]", async (request, context) => {
  const session = await requirePermission("integration:manage");
  const { id } = await context.params;
  const integrationId = id ?? "";

  const repository = await getRepository();
  const removed = await repository.deleteIntegration(session.organization.id, integrationId);

  if (!removed) return jsonError("not_found", "No such integration in this organisation.", 404);

  await recordAudit(
    session,
    { action: "integration.delete", targetType: "integration", targetId: integrationId },
    request,
  );

  return jsonOk({ deleted: true });
});
