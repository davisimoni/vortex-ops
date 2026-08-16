"use client";

import { Database, HardDrive, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useSession } from "@/components/system/session-provider";

/**
 * Tells the operator which storage mode they are running on — as a single
 * compact chip in the header, not a banner across the page.
 *
 * It used to be a full-width banner for the in-memory case, on the reasoning
 * that durability is worth announcing when it is absent. That is still true,
 * but a banner is the wrong *size* for a fact that is true on every single
 * page load: once said, it does not need repeating at that volume. A chip
 * says the same thing at a glance and gets out of the way.
 *
 * The one state that keeps a stronger visual (critical tone, not neutral) is
 * `degradedReason` — `DATABASE_URL` was set and Prisma could not use it. That
 * is a real misconfiguration risking silent data loss, not the documented
 * zero-setup path, and downgrading its visibility to match the demo-mode chip
 * would bury the one state an operator actually needs to notice. It stays
 * loud in `/api/health` and the server logs either way.
 */
export function StorageBadge() {
  const session = useSession();
  const { driver, durable, degradedReason, autoDetectedSqlite } = session.storage;

  if (degradedReason) {
    return (
      <Badge
        tone="critical"
        icon={TriangleAlert}
        title={`Database configured but unreachable — running on in-memory storage. ${degradedReason}`}
      >
        Storage: Degraded
      </Badge>
    );
  }

  if (durable) {
    return (
      <Badge
        tone="good"
        icon={Database}
        title={
          autoDetectedSqlite
            ? "Persistent storage via an auto-detected local SQLite file (prisma/dev.db)."
            : "Persistent storage via Prisma, configured through DATABASE_URL."
        }
      >
        Storage: Persistent
      </Badge>
    );
  }

  return (
    <Badge
      tone="neutral"
      icon={HardDrive}
      title={`Running on in-memory storage (${driver}) — no DATABASE_URL configured and no local database file found, so data resets when the server restarts. Expected for this demo deployment.`}
    >
      Storage: Demo Mode
    </Badge>
  );
}
