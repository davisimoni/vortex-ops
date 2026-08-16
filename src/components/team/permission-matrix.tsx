"use client";

import { Check, Minus, RotateCcw } from "lucide-react";
import { Fragment } from "react";

import { useEffectiveRole, usePermission } from "@/components/system/session-provider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  effectivePermissions,
  PERMISSION_GROUPS,
  PERMISSION_LABEL,
  ROLE_DEFINITIONS,
  ROLES,
} from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { useTeamStore } from "@/store/team-store";
import { useToastStore } from "@/store/toast-store";

/**
 * The permission matrix, rendered from `effectivePermissions()` — the same
 * function `requirePermission()` calls on every API route. A permission added
 * to a role appears here automatically, and a cell can never claim something
 * granted that the server would refuse.
 *
 * Cells for Owner/DevOps are editable when the viewer has `team:role:update`:
 * clicking toggles a per-organisation override. Owner keeps two permissions
 * locked (`team:read`, `team:role:update`) — removing them would leave the
 * organisation with no administrator and no way back in the product.
 */
export function PermissionMatrix() {
  const effective = useEffectiveRole();
  const overrides = useTeamStore((state) => state.overrides);
  const setOverride = useTeamStore((state) => state.setOverride);
  const pushToast = useToastStore((state) => state.push);
  const mayEdit = usePermission("team:role:update");

  const matrix = {
    owner: effectivePermissions("owner", overrides),
    devops: effectivePermissions("devops", overrides),
    viewer: effectivePermissions("viewer", overrides),
  };

  const isOverridden = (role: (typeof ROLES)[number], permission: string): boolean =>
    overrides.some((entry) => entry.role === role && entry.permission === permission);

  const isLocked = (role: (typeof ROLES)[number], permission: string): boolean =>
    role === "owner" && (permission === "team:read" || permission === "team:role:update");

  const toggle = async (
    role: (typeof ROLES)[number],
    permission: (typeof PERMISSION_GROUPS)[number]["permissions"][number],
  ): Promise<void> => {
    if (!mayEdit || isLocked(role, permission)) return;

    const currentlyGranted = matrix[role].includes(permission);
    const result = await setOverride(role, permission, currentlyGranted ? false : true);

    if (!result.ok) {
      pushToast({
        tone: "warning",
        title: "Permission unchanged",
        ...(result.message ? { body: result.message } : {}),
      });
    }
  };

  const resetOverride = async (
    role: (typeof ROLES)[number],
    permission: (typeof PERMISSION_GROUPS)[number]["permissions"][number],
  ): Promise<void> => {
    if (!mayEdit) return;
    await setOverride(role, permission, null);
  };

  return (
    <Card>
      <CardHeader
        title="Permission matrix"
        subtitle={
          mayEdit
            ? "Generated from the table the API enforces. Click a cell to override it for this organisation; the dot marks a customised cell."
            : "Generated from the table the API enforces, not maintained by hand."
        }
      />
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Permissions granted to each role in this organisation. A check means granted; a dash
              means denied. Cells with a dot have been customised from the default.
            </caption>
            <thead>
              <tr className="border-b border-hairline">
                <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                  Capability
                </th>
                {ROLES.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className={cn(
                      "px-3 py-2 text-center text-xs font-medium",
                      effective === role ? "text-ink" : "text-muted",
                    )}
                  >
                    {ROLE_DEFINITIONS[role].label}
                    {effective === role ? (
                      <span className="mt-0.5 block text-[10px] font-normal text-brand">
                        current view
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {PERMISSION_GROUPS.map((group) => (
                <Fragment key={group.label}>
                  <tr className="bg-raised/50">
                    <th
                      scope="colgroup"
                      colSpan={ROLES.length + 1}
                      className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"
                    >
                      {group.label}
                    </th>
                  </tr>

                  {group.permissions.map((permission) => (
                    <tr key={permission} className="border-b border-hairline last:border-b-0">
                      <th scope="row" className="px-3 py-2 text-xs font-normal text-ink2">
                        {PERMISSION_LABEL[permission]}
                      </th>
                      {ROLES.map((role) => {
                        const granted = matrix[role].includes(permission);
                        const overridden = isOverridden(role, permission);
                        const locked = isLocked(role, permission);
                        const interactive = mayEdit && !locked;

                        return (
                          <td key={role} className="px-3 py-2 text-center">
                            <button
                              type="button"
                              disabled={!interactive}
                              onClick={() => void toggle(role, permission)}
                              title={
                                locked
                                  ? "Owners cannot lose this — it would leave the organisation with no administrator."
                                  : interactive
                                    ? `Click to ${granted ? "revoke" : "grant"} for ${ROLE_DEFINITIONS[role].label}`
                                    : undefined
                              }
                              className={cn(
                                "relative mx-auto flex size-7 items-center justify-center rounded-md transition-colors",
                                interactive && "cursor-pointer hover:bg-raised",
                                !interactive && "cursor-default",
                              )}
                            >
                              {granted ? (
                                <>
                                  <Check
                                    aria-hidden="true"
                                    className="size-4 text-[var(--status-good)]"
                                  />
                                  <span className="sr-only">Granted</span>
                                </>
                              ) : (
                                <>
                                  <Minus aria-hidden="true" className="size-4 text-muted" />
                                  <span className="sr-only">Denied</span>
                                </>
                              )}
                              {overridden ? (
                                <span
                                  aria-hidden="true"
                                  className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-brand"
                                />
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {mayEdit && overrides.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
            <p className="text-xs text-muted">
              {overrides.length} permission{overrides.length === 1 ? "" : "s"} customised for this
              organisation.
            </p>
            <button
              type="button"
              onClick={() => {
                for (const override of overrides) {
                  void resetOverride(override.role, override.permission);
                }
              }}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              <RotateCcw aria-hidden="true" className="size-3" />
              Reset all to defaults
            </button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
