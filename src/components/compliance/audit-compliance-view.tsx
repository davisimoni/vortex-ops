"use client";

import { ShieldOff } from "lucide-react";

import { AuditLogCard } from "@/components/compliance/audit-log-card";
import { ComplianceExportCard } from "@/components/compliance/compliance-export-card";
import { usePermission } from "@/components/system/session-provider";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Dedicated home for the two compliance surfaces that used to live only at
 * the bottom of Team & access — SOC 2 evidence requests and access reviews
 * are their own workflow, not an afterthought under team management, and
 * burying them there is exactly the kind of thing a recruiter clicking
 * through the product would never find without being told where to look.
 *
 * `ComplianceExportCard` and `AuditLogCard` still render on `/settings/team`
 * too. Not a stray duplicate: `tests/e2e/compliance.spec.ts` asserts the
 * export is reachable from both surfaces, on the reasoning that someone
 * mid-incident-review on the team page should not have to navigate away to
 * pull the export they need.
 */
export function AuditComplianceView() {
  const mayExport = usePermission("compliance:export");
  const mayReadAudit = usePermission("audit:read");

  if (!mayExport && !mayReadAudit) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
          <ShieldOff aria-hidden="true" className="size-6 text-muted" />
          <p className="text-sm font-medium text-ink">Your role does not include audit access</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted">
            The audit trail and compliance exports are available to Owner and DevOps roles. Ask an
            Owner to change your role if you need this.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {mayExport ? <ComplianceExportCard /> : null}
      {mayReadAudit ? <AuditLogCard /> : null}
    </div>
  );
}
