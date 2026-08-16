import { describe, expect, it } from "vitest";

import {
  allows,
  assertPermission,
  can,
  effectivePermissions,
  isLastOwner,
  PERMISSION_GROUPS,
  PERMISSION_LABEL,
  PERMISSIONS,
  PermissionError,
  permissionsFor,
  ROLES,
  type PermissionOverride,
} from "@/lib/rbac";

describe("permission matrix", () => {
  it("grants an owner every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(can("owner", permission)).toBe(true);
    }
  });

  it("keeps a viewer strictly read-only", () => {
    const writes = PERMISSIONS.filter((permission) => !permission.endsWith(":read"));
    for (const permission of writes) {
      expect(can("viewer", permission)).toBe(false);
    }
  });

  it("lets devops run the on-call workflow but not administer the account", () => {
    expect(can("devops", "incident:assign")).toBe(true);
    expect(can("devops", "incident:transition")).toBe(true);
    expect(can("devops", "integration:test")).toBe(true);

    expect(can("devops", "team:invite")).toBe(false);
    expect(can("devops", "team:role:update")).toBe(false);
    expect(can("devops", "integration:manage")).toBe(false);
    expect(can("devops", "settings:billing")).toBe(false);
  });

  it("gives devops and owner the operational tooling — chaos drills and raw logs — but not viewer", () => {
    expect(can("owner", "chaos:trigger")).toBe(true);
    expect(can("owner", "logs:read")).toBe(true);
    expect(can("devops", "chaos:trigger")).toBe(true);
    expect(can("devops", "logs:read")).toBe(true);

    expect(can("viewer", "chaos:trigger")).toBe(false);
    expect(can("viewer", "logs:read")).toBe(false);
  });

  it("hides billing from everyone but the owner", () => {
    expect(can("owner", "settings:billing")).toBe(true);
    expect(can("devops", "settings:billing")).toBe(false);
    expect(can("viewer", "settings:billing")).toBe(false);
  });

  it("grants strictly narrowing permission sets down the role ladder", () => {
    const owner = new Set(permissionsFor("owner"));
    const devops = new Set(permissionsFor("devops"));
    const viewer = new Set(permissionsFor("viewer"));

    for (const permission of devops) expect(owner.has(permission)).toBe(true);
    for (const permission of viewer) expect(devops.has(permission)).toBe(true);
  });
});

describe("matrix completeness", () => {
  it("labels every permission, so the UI can never render a bare key", () => {
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_LABEL[permission]).toBeTruthy();
    }
  });

  it("places every permission in exactly one display group", () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("covers every role", () => {
    expect(ROLES).toHaveLength(3);
    for (const role of ROLES) expect(permissionsFor(role).length).toBeGreaterThan(0);
  });
});

describe("assertPermission", () => {
  it("passes silently when the role is allowed", () => {
    expect(() => assertPermission("owner", "integration:manage")).not.toThrow();
  });

  it("throws a PermissionError carrying what was missing", () => {
    try {
      assertPermission("viewer", "incident:transition");
      expect.unreachable("assertPermission should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionError);
      const permissionError = error as PermissionError;
      expect(permissionError.status).toBe(403);
      expect(permissionError.permission).toBe("incident:transition");
      expect(permissionError.role).toBe("viewer");
    }
  });
});

describe("isLastOwner", () => {
  const members = [
    { id: "a", role: "owner" as const },
    { id: "b", role: "devops" as const },
    { id: "c", role: "viewer" as const },
  ];

  it("protects the only owner", () => {
    expect(isLastOwner(members, "a")).toBe(true);
  });

  it("does not protect non-owners", () => {
    expect(isLastOwner(members, "b")).toBe(false);
  });

  it("stops protecting once a second owner exists", () => {
    const twoOwners = [...members, { id: "d", role: "owner" as const }];
    expect(isLastOwner(twoOwners, "a")).toBe(false);
    expect(isLastOwner(twoOwners, "d")).toBe(false);
  });

  it("handles a workspace with no owner at all", () => {
    expect(isLastOwner([{ id: "b", role: "devops" }], "b")).toBe(false);
  });
});

describe("effectivePermissions — per-organisation overrides", () => {
  it("matches the built-in defaults with no overrides", () => {
    for (const role of ROLES) {
      expect(effectivePermissions(role, [])).toEqual(permissionsFor(role));
    }
  });

  it("grants an extra permission via an override", () => {
    const overrides: PermissionOverride[] = [
      { role: "viewer", permission: "audit:read", granted: true },
    ];
    expect(allows(effectivePermissions("viewer", overrides), "audit:read")).toBe(true);
    // Untouched roles are unaffected by another role's override.
    expect(allows(effectivePermissions("devops", overrides), "audit:read")).toBe(
      allows(permissionsFor("devops"), "audit:read"),
    );
  });

  it("revokes a default permission via an override", () => {
    const overrides: PermissionOverride[] = [
      { role: "devops", permission: "integration:test", granted: false },
    ];
    expect(allows(effectivePermissions("devops", overrides), "integration:test")).toBe(false);
  });

  it("ignores overrides for a different role", () => {
    const overrides: PermissionOverride[] = [
      { role: "owner", permission: "team:invite", granted: false },
    ];
    // Owner's own list can be edited by this override, but viewer must not
    // pick it up.
    expect(allows(effectivePermissions("viewer", overrides), "team:invite")).toBe(false);
    expect(allows(effectivePermissions("owner", overrides), "team:invite")).toBe(false);
  });

  it("never lets team:read be revoked, even by an explicit override", () => {
    // Without read access to the team, a member cannot even see who to ask for
    // the access they are missing — support tickets would replace the product.
    const overrides: PermissionOverride[] = [
      { role: "viewer", permission: "team:read", granted: false },
    ];
    expect(allows(effectivePermissions("viewer", overrides), "team:read")).toBe(true);
  });

  it("keeps the result ordered the same way as the canonical PERMISSIONS list", () => {
    const overrides: PermissionOverride[] = [
      { role: "viewer", permission: "settings:billing", granted: true },
    ];
    const effective = effectivePermissions("viewer", overrides);
    const expectedOrder = PERMISSIONS.filter((permission) => effective.includes(permission));
    expect(effective).toEqual(expectedOrder);
  });
});

describe("allows", () => {
  it("is a plain membership check over a resolved permission list", () => {
    expect(allows(["incident:read", "incident:create"], "incident:read")).toBe(true);
    expect(allows(["incident:read"], "incident:create")).toBe(false);
  });
});
