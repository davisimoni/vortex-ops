"use client";

import { Database, TriangleAlert } from "lucide-react";

import { useSession } from "@/components/system/session-provider";

/**
 * Tells the operator which storage mode they are running on.
 *
 * Two states get a banner:
 *
 *  - **Degraded**: `DATABASE_URL` was set but Prisma could not be used. This is
 *    a misconfiguration, and it is loud everywhere — here, in `/api/health`,
 *    and in the server logs — because the alternative is silently serving
 *    ephemeral data to a customer who believes their incidents are durable.
 *  - **In-memory by design**: no database configured at all, which is the
 *    documented zero-setup path. Shown once, plainly, not as a warning — this
 *    is the product working as intended for someone trying it out.
 *
 * Persistent storage gets no banner. That is the point: durability is the
 * unremarkable case, not something to announce.
 */
export function StorageBanner() {
  const session = useSession();
  const { driver, durable, degradedReason } = session.storage;

  if (durable) return null;

  if (degradedReason) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-crit/40 bg-crit/10 px-3 py-2 sm:px-5">
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-crit" />
        <p className="min-w-0 text-xs text-ink">
          <strong className="font-semibold">Database configured but unreachable.</strong> Running on
          in-memory storage — nothing written this session survives a restart.{" "}
          <span className="text-muted">{degradedReason}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-raised/60 px-3 py-2 sm:px-5">
      <Database aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
      <p className="min-w-0 text-xs text-ink2">
        Running on in-memory storage ({driver}) — no <code className="rounded bg-raised px-1 font-mono text-[11px]">DATABASE_URL</code> is
        configured, so data resets when the server restarts. Set one to persist incidents, RBAC
        and integrations.
      </p>
    </div>
  );
}
