import type { Permission } from "@/lib/rbac";
import type { Role } from "@/types";

/**
 * The session shape shared by the server and the browser.
 *
 * `permissions` is the *resolved* set — defaults for the role, plus this
 * organisation's overrides — computed server-side and sent down. The client
 * never re-derives it: if the browser computed permissions from a role, a
 * tenant's custom matrix would apply only where somebody remembered to look it
 * up, and the UI would disagree with the API about what is allowed.
 */

export type StorageDriver = "prisma" | "memory";

export interface SessionOrganization {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly environment: "production" | "staging" | "development";
}

export interface StorageStatus {
  readonly driver: StorageDriver;
  readonly durable: boolean;
  /** Set when a database was configured but could not be used. */
  readonly degradedReason: string | null;
  /** True when `driver` is "prisma" via the auto-detected local SQLite file, not an explicit DATABASE_URL. */
  readonly autoDetectedSqlite: boolean;
}

export interface SessionSnapshot {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  };
  readonly organization: SessionOrganization & { readonly metricSeed: number };
  /** Every organisation this user may switch to. */
  readonly organizations: readonly SessionOrganization[];
  readonly role: Role;
  readonly permissions: readonly Permission[];
  readonly storage: StorageStatus;
}

export const ENVIRONMENT_LABEL: Record<SessionOrganization["environment"], string> = {
  production: "Production",
  staging: "Staging",
  development: "Development",
};
