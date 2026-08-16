"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { effectivePermissions, type Permission } from "@/lib/rbac";
import type { SessionSnapshot } from "@/lib/session";
import { usePreviewStore } from "@/store/session-store";
import type { Role } from "@/types";

/**
 * The session, resolved on the server and handed to the client once.
 *
 * Not fetched from the browser: the authenticated layout already resolved it
 * server-side to decide whether to render at all, and refetching it would mean
 * a flash of unauthenticated UI on every navigation.
 */

const SessionContext = createContext<SessionSnapshot | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  readonly session: SessionSnapshot;
  readonly children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionSnapshot {
  const session = useContext(SessionContext);
  if (!session) {
    // Thrown rather than returning null: every consumer is inside the
    // authenticated layout, so a missing provider is a wiring bug, and a null
    // that each caller has to handle would spread that bug across the codebase.
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return session;
}

/** The role the UI is currently rendering for — the preview lens, if one is on. */
export function useEffectiveRole(): Role {
  const session = useSession();
  const previewRole = usePreviewStore((state) => state.previewRole);
  return previewRole ?? session.role;
}

export function useIsPreviewing(): boolean {
  return usePreviewStore((state) => state.previewRole !== null);
}

/**
 * Whether the current view may do something.
 *
 * With no preview active this returns the server-resolved permission set
 * verbatim — the same list the API enforces. Under a preview it recomputes for
 * the previewed role, using this organisation's overrides so the lens reflects
 * the tenant's real matrix rather than the built-in defaults.
 */
export function usePermission(permission: Permission): boolean {
  const session = useSession();
  const previewRole = usePreviewStore((state) => state.previewRole);
  const overrides = usePreviewStore((state) => state.overrides);

  const permissions = useMemo(
    () => (previewRole === null ? session.permissions : effectivePermissions(previewRole, overrides)),
    [previewRole, overrides, session.permissions],
  );

  return permissions.includes(permission);
}

/** The organisation currently in scope. Every fetch is implicitly filtered by it. */
export function useOrganization(): SessionSnapshot["organization"] {
  return useSession().organization;
}
