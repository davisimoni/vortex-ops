"use client";

import { Eye, RotateCcw } from "lucide-react";

import { useIsPreviewing, useSession } from "@/components/system/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { effectivePermissions, ROLE_DEFINITIONS, ROLES } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { usePreviewStore } from "@/store/session-store";
import type { Role } from "@/types";

/**
 * Role preview.
 *
 * Switching here changes the role every `usePermission()` call in the app
 * reads — go to Incidents as a Viewer and the status stepper locks, the
 * assignee select disables and the note composer is replaced by an
 * explanation, on the *other* page. A permissions table you can only read is a
 * claim; one you can drive is a demonstration.
 *
 * It is explicitly a **preview**, not a role switch: every request the browser
 * makes still carries the real session cookie, so the server enforces your
 * actual role regardless of what this shows. Real cross-tenant, cross-role
 * testing is what the demo accounts on the sign-in page are for.
 */
export function RoleSimulator() {
  const session = useSession();
  const previewing = useIsPreviewing();
  const previewRole = usePreviewStore((state) => state.previewRole);
  const setPreviewRole = usePreviewStore((state) => state.setPreviewRole);
  const overrides = usePreviewStore((state) => state.overrides);

  const effective = previewRole ?? session.role;

  return (
    <Card>
      <CardHeader
        title="Role preview"
        subtitle="See the product as each role experiences it in this organisation. A UI lens — the server still enforces your real role."
        actions={
          !previewing ? (
            <Badge tone="neutral" icon={Eye}>
              Your own role
            </Badge>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setPreviewRole(null)}>
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Reset
            </Button>
          )
        }
      />
      <CardBody>
        <div className="grid gap-3 sm:grid-cols-3">
          {ROLES.map((role) => {
            const definition = ROLE_DEFINITIONS[role];
            const active = effective === role;
            const isOwn = session.role === role;

            return (
              <button
                key={role}
                type="button"
                aria-pressed={active}
                onClick={() => setPreviewRole(isOwn ? null : (role as Role))}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors",
                  active ? "border-brand bg-brand/8" : "border-hairline hover:border-hairline-strong",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{definition.label}</span>
                  {isOwn ? (
                    <span className="rounded-md border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
                      You
                    </span>
                  ) : null}
                </span>
                <span className="text-xs leading-relaxed text-muted">{definition.description}</span>
                <span className="tabular mt-1 text-[11px] text-ink2">
                  {effectivePermissions(role, overrides).length} permissions in this organisation
                </span>
              </button>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
