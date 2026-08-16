import type { Metadata } from "next";

import { LogViewer } from "@/components/logs/log-viewer";
import { readSession } from "@/server/session/context";

export const metadata: Metadata = {
  title: "Logs",
  description: "Live, filterable tail of the application's structured logs.",
};

export const dynamic = "force-dynamic";

/**
 * Permission is checked here, server-side, before the viewer ever renders —
 * not only inside `LogViewer` via `usePermission`.
 *
 * `EventSource` cannot see the 403 `/api/logs/stream` would return for a role
 * without `logs:read`: a non-2xx response just looks like a network error to
 * it, and it retries forever. Every other gated page in this app is readable
 * by every role, so a bare `usePermission` check is enough to hide a button;
 * this is the first page an entire role is excluded from, so it needs the
 * stream to never open in the first place.
 */
export default async function LogsPage() {
  const session = await readSession();
  const allowed = session?.permissions.includes("logs:read") ?? false;

  if (!allowed) {
    return (
      <div className="rounded-xl border border-hairline bg-surface p-6">
        <p className="text-sm font-medium text-ink">You don&apos;t have access to the log viewer.</p>
        <p className="mt-1 text-sm text-muted">
          Viewing raw process logs requires the DevOps or Owner role in this organisation.
        </p>
      </div>
    );
  }

  return <LogViewer />;
}
