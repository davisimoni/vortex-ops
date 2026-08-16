"use client";

import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { AuditLogCard } from "@/components/compliance/audit-log-card";
import { ComplianceExportCard } from "@/components/compliance/compliance-export-card";
import { usePermission } from "@/components/system/session-provider";
import { MemberTable } from "@/components/team/member-table";
import { PermissionMatrix } from "@/components/team/permission-matrix";
import { RoleSimulator } from "@/components/team/role-simulator";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ROLE_DEFINITIONS, ROLES } from "@/lib/rbac";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamStore } from "@/store/team-store";
import { useToastStore } from "@/store/toast-store";
import type { Role } from "@/types";

function InviteForm() {
  const invite = useTeamStore((state) => state.invite);
  const pushToast = useToastStore((state) => state.push);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    const result = await invite(name, email, role);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? "Could not send the invite.");
      return;
    }
    pushToast({
      tone: "success",
      title: `Invited ${name.trim()}`,
      body: `They will join as ${ROLE_DEFINITIONS[role].label} once they accept.`,
    });
    setName("");
    setEmail("");
    setRole("viewer");
    setError(undefined);
  };

  return (
    <form
      /*
       * Native constraint validation is switched off deliberately. Left on, the
       * browser blocks submission for a malformed address and shows an unstyled
       * bubble that vanishes on the next keystroke, is announced inconsistently,
       * and cannot be positioned — while our own `role="alert"` message, which
       * every other form in the app uses, never gets a chance to render. One
       * validation path, one place to read the error.
       */
      noValidate
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Name" required>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
            placeholder="Jordan Blake"
            autoComplete="off"
          />
        )}
      </Field>

      <Field label="Work email" required error={error}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(undefined);
            }}
            placeholder="jordan@your-company.com"
            autoComplete="off"
          />
        )}
      </Field>

      <Field label="Role">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="sm:w-36"
          >
            {ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {ROLE_DEFINITIONS[entry].label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Button type="submit" variant="primary" loading={submitting}>
        <UserPlus aria-hidden="true" className="size-3.5" />
        Send invite
      </Button>
    </form>
  );
}

export function TeamView() {
  const ready = useTeamStore((state) => state.ready);
  const loadError = useTeamStore((state) => state.loadError);
  const members = useTeamStore((state) => state.members);
  const load = useTeamStore((state) => state.load);
  const mayInvite = usePermission("team:invite");
  const mayReadAudit = usePermission("audit:read");
  const mayExport = usePermission("compliance:export");

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardBody className="text-sm text-crit">{loadError}</CardBody>
      </Card>
    );
  }

  const owners = members.filter((member) => member.role === "owner").length;

  return (
    <div className="flex flex-col gap-4">
      <RoleSimulator />

      <Card>
        <CardHeader
          title="Members"
          subtitle={`${members.length} people · ${owners} owner${owners === 1 ? "" : "s"} · roles apply immediately across every surface`}
        />
        <CardBody className="flex flex-col gap-5">
          <MemberTable members={members} now={now} />

          <div className="border-t border-hairline pt-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Invite a teammate
            </h3>
            {mayInvite ? (
              <InviteForm />
            ) : (
              <p className="rounded-lg border border-hairline bg-raised/40 p-3 text-xs text-muted">
                Your role cannot invite members. Ask an Owner to add someone to this workspace.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      <PermissionMatrix />

      {mayExport ? <ComplianceExportCard /> : null}
      {mayReadAudit ? <AuditLogCard /> : null}
    </div>
  );
}
