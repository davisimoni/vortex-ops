"use client";

import { MailCheck, UserMinus } from "lucide-react";
import { useState } from "react";

import { usePermission, useSession } from "@/components/system/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { formatRelative, initials } from "@/lib/format";
import { isLastOwner, ROLE_DEFINITIONS, ROLES } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { useTeamStore } from "@/store/team-store";
import { useToastStore } from "@/store/toast-store";
import type { MemberStatus, Role, TeamMember } from "@/types";

const STATUS_TONE: Record<MemberStatus, "good" | "warning" | "neutral"> = {
  active: "good",
  invited: "warning",
  suspended: "neutral",
};

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  invited: "Invite pending",
  suspended: "Suspended",
};

function MemberRow({
  member,
  members,
  now,
}: {
  readonly member: TeamMember;
  readonly members: readonly TeamMember[];
  readonly now: number;
}) {
  const updateRole = useTeamStore((state) => state.updateRole);
  const remove = useTeamStore((state) => state.remove);
  const pushToast = useToastStore((state) => state.push);
  const session = useSession();

  const mayChangeRole = usePermission("team:role:update");
  const mayRemove = usePermission("team:remove");

  const [confirming, setConfirming] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const lastOwner = isLastOwner(members, member.id);
  const isSelf = member.id === session.user.id;

  const handleRole = async (role: Role): Promise<void> => {
    setSavingRole(true);
    const result = await updateRole(member.id, role);
    setSavingRole(false);

    if (!result.ok) {
      pushToast({
        tone: "warning",
        title: "Role unchanged",
        ...(result.message ? { body: result.message } : {}),
      });
      return;
    }
    pushToast({
      tone: "success",
      title: `${member.name} is now ${ROLE_DEFINITIONS[role].label}`,
    });
  };

  return (
    <tr className="border-b border-hairline last:border-b-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-ink"
          >
            {initials(member.name)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="block truncate text-sm font-medium text-ink">{member.name}</span>
              {isSelf ? (
                <span className="rounded-md border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
                  You
                </span>
              ) : null}
            </span>
            <span className="block truncate text-xs text-muted">{member.email}</span>
          </span>
        </div>
      </td>

      <td className="px-3 py-2.5">
        <Select
          value={member.role}
          disabled={!mayChangeRole || lastOwner || savingRole}
          aria-label={`Role for ${member.name}`}
          title={
            lastOwner
              ? "This is the only Owner. Promote someone else before changing this role."
              : mayChangeRole
                ? undefined
                : "Your role cannot change other members' roles."
          }
          onChange={(event) => void handleRole(event.target.value as Role)}
          className="w-36"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_DEFINITIONS[role].label}
            </option>
          ))}
        </Select>
      </td>

      <td className="px-3 py-2.5">
        <Badge tone={STATUS_TONE[member.status]} {...(member.status === "invited" ? { icon: MailCheck } : { dot: true })}>
          {STATUS_LABEL[member.status]}
        </Badge>
      </td>

      <td className="px-3 py-2.5 text-xs text-ink2">{member.rotation ?? "—"}</td>

      <td className="px-3 py-2.5 text-xs text-muted">
        {member.lastActiveAt === null ? "Never" : formatRelative(member.lastActiveAt, now)}
      </td>

      <td className="px-3 py-2.5 text-right">
        {confirming ? (
          <span className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                void remove(member.id).then((result) => {
                  if (!result.ok) {
                    pushToast({
                      tone: "warning",
                      title: "Member not removed",
                      ...(result.message ? { body: result.message } : {}),
                    });
                    setConfirming(false);
                    return;
                  }
                  pushToast({ tone: "info", title: `Removed ${member.name}` });
                });
              }}
            >
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={!mayRemove || lastOwner}
            title={lastOwner ? "The only Owner cannot be removed." : undefined}
            onClick={() => setConfirming(true)}
          >
            <UserMinus aria-hidden="true" className="size-3.5" />
            <span className="sr-only sm:not-sr-only">Remove</span>
          </Button>
        )}
      </td>
    </tr>
  );
}

export function MemberTable({
  members,
  now,
  className,
}: {
  readonly members: readonly TeamMember[];
  readonly now: number;
  readonly className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[720px] border-collapse text-left">
        <caption className="sr-only">Workspace members, their roles and on-call rotations.</caption>
        <thead>
          <tr className="border-b border-hairline">
            {["Member", "Role", "Status", "Rotation", "Last active", ""].map((heading, index) => (
              <th
                key={heading || `actions-${index}`}
                scope="col"
                className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted"
              >
                {heading || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} members={members} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
