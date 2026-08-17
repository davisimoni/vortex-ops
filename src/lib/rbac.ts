import type { Role } from "@/types";

/**
 * Role-based access control.
 *
 * The matrix below is the single source of truth. UI components ask `can()` to
 * decide whether to disable a control; API routes ask the same function before
 * mutating anything. Hiding a button is a courtesy — the server-side check is
 * the actual boundary, so both must read from the same table or they drift.
 */

export const PERMISSIONS = [
  "metrics:read",
  "incident:read",
  "incident:create",
  "incident:assign",
  "incident:transition",
  "incident:comment",
  "maintenance:manage",
  "integration:read",
  "integration:manage",
  "integration:test",
  "team:read",
  "team:invite",
  "team:role:update",
  "team:remove",
  "audit:read",
  "compliance:export",
  "settings:billing",
  "chaos:trigger",
  "logs:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES: readonly Role[] = ["owner", "devops", "viewer"] as const;

export interface RoleDefinition {
  readonly id: Role;
  readonly label: string;
  readonly description: string;
}

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  owner: {
    id: "owner",
    label: "Owner",
    description: "Full control, including billing, integrations and team membership.",
  },
  devops: {
    id: "devops",
    label: "DevOps",
    description: "Runs the on-call workflow: assigns, transitions and annotates incidents.",
  },
  viewer: {
    id: "viewer",
    label: "Viewer",
    description: "Read-only access to dashboards and incident history. Cannot change state.",
  },
};

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [...PERMISSIONS],
  devops: [
    "metrics:read",
    "incident:read",
    "incident:create",
    "incident:assign",
    "incident:transition",
    "incident:comment",
    // Scheduling a maintenance window is operational work, same tier as
    // declaring an incident — the people who carry the pager are the people
    // who get to tell customers about planned downtime.
    "maintenance:manage",
    "integration:read",
    "integration:test",
    "team:read",
    // On-call needs the audit trail during an incident review, and the SLA
    // export is the artefact a post-mortem is written from.
    "audit:read",
    "compliance:export",
    // Chaos drills and raw process logs are both operational tooling — the
    // people who carry the pager are the people who get to pull them.
    "chaos:trigger",
    "logs:read",
  ],
  /*
   * A viewer reads dashboards and incident history and nothing else. Not the
   * audit log: it names who did what and from which address, which is more
   * than a read-only stakeholder needs and exactly what an attacker with a
   * low-privilege account would map the organisation with.
   */
  viewer: ["metrics:read", "incident:read", "integration:read", "team:read"],
};

const PERMISSION_SETS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ROLE_PERMISSIONS.owner),
  devops: new Set(ROLE_PERMISSIONS.devops),
  viewer: new Set(ROLE_PERMISSIONS.viewer),
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSION_SETS[role].has(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Human-readable labels for the permission matrix on the team page. */
export const PERMISSION_LABEL: Record<Permission, string> = {
  "metrics:read": "View dashboards",
  "incident:read": "View incidents",
  "incident:create": "Declare incidents",
  "incident:assign": "Assign responders",
  "incident:transition": "Change incident status",
  "incident:comment": "Post timeline notes",
  "maintenance:manage": "Schedule maintenance windows",
  "integration:read": "View integrations",
  "integration:manage": "Create & edit integrations",
  "integration:test": "Send test payloads",
  "team:read": "View team",
  "team:invite": "Invite members",
  "team:role:update": "Change roles",
  "team:remove": "Remove members",
  "audit:read": "Read the audit trail",
  "compliance:export": "Export compliance reports",
  "settings:billing": "Manage billing",
  "chaos:trigger": "Run chaos engineering drills",
  "logs:read": "View live process logs",
};

/** Grouping for the matrix so nineteen rows read as five sections. */
export const PERMISSION_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly permissions: readonly Permission[];
}> = [
  { label: "Observability", permissions: ["metrics:read", "logs:read"] },
  {
    label: "Incidents",
    permissions: [
      "incident:read",
      "incident:create",
      "incident:assign",
      "incident:transition",
      "incident:comment",
      "chaos:trigger",
      "maintenance:manage",
    ],
  },
  {
    label: "Integrations",
    permissions: ["integration:read", "integration:manage", "integration:test"],
  },
  {
    label: "Team & account",
    permissions: [
      "team:read",
      "team:invite",
      "team:role:update",
      "team:remove",
      "settings:billing",
    ],
  },
  { label: "Compliance", permissions: ["audit:read", "compliance:export"] },
];

/* -------------------------------------------------------------------------- */
/* Per-organisation overrides                                                  */
/* -------------------------------------------------------------------------- */

export interface PermissionOverride {
  readonly role: Role;
  readonly permission: Permission;
  readonly granted: boolean;
}

/**
 * The effective permission set for a role in one organisation.
 *
 * Overrides are stored as *deviations*, not as a full copy of the matrix, so a
 * tenant that never customised anything keeps tracking the defaults — including
 * a permission added in a later release. Copying the whole matrix per tenant at
 * signup is how products end up with customers silently missing features they
 * are entitled to.
 */
export function effectivePermissions(
  role: Role,
  overrides: readonly PermissionOverride[] = [],
): Permission[] {
  const effective = new Set<Permission>(ROLE_PERMISSIONS[role]);

  for (const override of overrides) {
    if (override.role !== role) continue;
    if (override.granted) effective.add(override.permission);
    else effective.delete(override.permission);
  }

  // Read access to the team is not revocable: without it a member cannot see
  // who to ask for the access they are missing, and support tickets replace the
  // product. Everything else is the tenant's call.
  effective.add("team:read");

  return PERMISSIONS.filter((permission) => effective.has(permission));
}

/** `can()` against an already-resolved permission set. */
export function allows(permissions: readonly Permission[], permission: Permission): boolean {
  return permissions.includes(permission);
}

/** Raised when a caller lacks a permission. Carries what was missing. */
export class PermissionError extends Error {
  readonly permission: Permission;
  readonly role: Role;
  readonly status = 403;

  constructor(role: Role, permission: Permission) {
    super(`Role "${role}" is missing the "${permission}" permission`);
    this.name = "PermissionError";
    this.role = role;
    this.permission = permission;
  }
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new PermissionError(role, permission);
}

/**
 * The last owner cannot be demoted or removed.
 *
 * Without this an account can be orphaned: nobody left who can manage billing
 * or invite anyone, and no in-product way to recover.
 */
export function isLastOwner(members: ReadonlyArray<{ id: string; role: Role }>, memberId: string): boolean {
  const owners = members.filter((member) => member.role === "owner");
  return owners.length === 1 && owners[0]?.id === memberId;
}
