import { logger } from "@/lib/logger";
import { isEncryptionAvailable } from "@/server/crypto/secrets";
import { getStorageStatus } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOTED_AT = Date.now();

interface HealthCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Liveness and readiness probe.
 *
 * Reports what is actually configured rather than a bare `ok`. The most
 * important line is `storage`: the application deliberately falls back to
 * in-memory state when a database is unreachable, so this endpoint is where a
 * deploy that *thinks* it is persistent is caught. A probe that stayed green
 * through that would be the whole point of the fallback turning into a trap.
 */
export async function GET(): Promise<Response> {
  const storage = await getStorageStatus();

  const checks: HealthCheck[] = [
    {
      name: "storage",
      // Degraded means DATABASE_URL was set and could not be used. No
      // DATABASE_URL at all is a legitimate configuration, not a failure.
      ok: storage.degradedReason === null,
      detail: storage.durable
        ? "Persistent storage via Prisma."
        : storage.degradedReason
          ? `DATABASE_URL is set but unusable — running on ephemeral in-memory storage. ${storage.degradedReason}`
          : "No DATABASE_URL configured; running on in-memory storage. Data is lost on restart.",
    },
    {
      name: "credential_encryption",
      ok: isEncryptionAvailable(),
      detail: isEncryptionAvailable()
        ? "AES-256-GCM key available; third-party credentials can be stored."
        : "No encryption key — integrations that need a credential are refused rather than stored in plaintext.",
    },
    {
      name: "session_secret",
      ok: (process.env.VORTEX_SESSION_SECRET?.length ?? 0) >= 32,
      detail:
        (process.env.VORTEX_SESSION_SECRET?.length ?? 0) >= 32
          ? "Session signing secret configured."
          : "VORTEX_SESSION_SECRET is unset or too short — sessions are signed with an ephemeral per-process key and do not survive a restart.",
    },
    {
      name: "webhook_signing",
      ok: Boolean(process.env.VORTEX_WEBHOOK_SIGNING_SECRET),
      detail: process.env.VORTEX_WEBHOOK_SIGNING_SECRET
        ? "Signing secret present; custom webhook payloads are signed."
        : "VORTEX_WEBHOOK_SIGNING_SECRET is unset — custom webhooks are sent unsigned.",
    },
    {
      name: "mail_relay",
      ok: Boolean(process.env.VORTEX_MAIL_RELAY_URL),
      detail: process.env.VORTEX_MAIL_RELAY_URL
        ? "Mail relay configured."
        : "VORTEX_MAIL_RELAY_URL is unset — email integrations return 503 rather than reporting a false success.",
    },
    {
      name: "ssrf_guard",
      ok: process.env.VORTEX_ALLOW_PRIVATE_WEBHOOK_HOSTS !== "1",
      detail:
        process.env.VORTEX_ALLOW_PRIVATE_WEBHOOK_HOSTS === "1"
          ? "Private webhook hosts are ALLOWED. Development only — never enable this in production."
          : "Private, loopback and link-local webhook destinations are blocked.",
    },
  ];

  const body = {
    // The process serves traffic in every state above, so liveness stays "ok";
    // `checks` is what a readiness gate or a human should read.
    status: "ok" as const,
    service: process.env.VORTEX_SERVICE_NAME ?? "vortex-ops",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0",
    env: process.env.VORTEX_ENV ?? "development",
    region: process.env.VORTEX_REGION ?? "eu-central-1",
    uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
    storage,
    checks,
  };

  logger.debug("Health probe", { failing: checks.filter((check) => !check.ok).length });

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
