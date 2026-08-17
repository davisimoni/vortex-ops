"use client";

import { Bot, MessageSquarePlus, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { RootCauseCard } from "@/components/incidents/root-cause-card";
import { StatusStepper } from "@/components/incidents/status-stepper";
import { usePermission } from "@/components/system/session-provider";
import { SeverityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Select, Textarea } from "@/components/ui/field";
import { formatCompact, formatDuration, formatRelative, formatTimestamp } from "@/lib/format";
import { incidentDuration } from "@/lib/incidents";
import { serviceName } from "@/lib/services";
import { cn } from "@/lib/utils";
import type { MutationResult } from "@/store/incident-store";
import { useIncidentStore } from "@/store/incident-store";
import { assignableMembers, useTeamStore } from "@/store/team-store";
import { useToastStore } from "@/store/toast-store";
import type { Incident, IncidentEvent, IncidentStatus } from "@/types";

const EVENT_ICON: Record<IncidentEvent["kind"], string> = {
  opened: "bg-crit",
  status: "bg-brand",
  assignment: "bg-s3",
  note: "bg-[var(--ink-muted)]",
  notification: "bg-warn",
};

function Timeline({ events, now }: { readonly events: readonly IncidentEvent[]; readonly now: number }) {
  return (
    <ol className="flex flex-col gap-0">
      {events.map((event, index) => (
        <li key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", EVENT_ICON[event.kind])} />
            {index < events.length - 1 ? (
              <span aria-hidden="true" className="w-px flex-1 bg-hairline" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <p className="text-xs leading-relaxed text-ink">{event.message}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              {event.actor === null ? (
                <span className="inline-flex items-center gap-1">
                  <Bot aria-hidden="true" className="size-3" />
                  Alerting engine
                </span>
              ) : (
                <span>{event.actor}</span>
              )}
              <span aria-hidden="true">·</span>
              <time dateTime={new Date(event.at).toISOString()} title={formatTimestamp(event.at)}>
                {formatRelative(event.at, now)}
              </time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface IncidentDrawerProps {
  readonly incident: Incident | null;
  readonly onClose: () => void;
  readonly now: number;
}

export function IncidentDrawer({ incident, onClose, now }: IncidentDrawerProps) {
  const members = useTeamStore((state) => state.members);
  const assign = useIncidentStore((state) => state.assign);
  const transition = useIncidentStore((state) => state.transition);
  const comment = useIncidentStore((state) => state.comment);
  const pushToast = useToastStore((state) => state.push);

  const mayAssign = usePermission("incident:assign");
  const mayTransition = usePermission("incident:transition");
  const mayComment = usePermission("incident:comment");

  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (!incident) return null;

  const report = (result: MutationResult): void => {
    if (result.ok) return;
    pushToast({ tone: "warning", title: "Change not applied", ...(result.message ? { body: result.message } : {}) });
  };

  const handleTransition = async (next: IncidentStatus): Promise<void> => {
    setBusy(true);
    report(await transition(incident.id, next));
    setBusy(false);
  };

  const handleAssign = async (memberId: string): Promise<void> => {
    setBusy(true);
    report(await assign(incident.id, memberId === "" ? null : memberId));
    setBusy(false);
  };

  const handleNote = async (): Promise<void> => {
    const result = await comment(incident.id, note);
    if (result.ok) {
      setNote("");
      setNoteError(undefined);
      return;
    }
    setNoteError(result.message ?? "Could not add the note.");
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={incident.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <span className="tabular">{incident.id}</span>
          <span aria-hidden="true">·</span>
          <span>{serviceName(incident.serviceId)}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-ink2">{incident.summary}</p>

        <RootCauseCard incident={incident} now={now} />

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Status</h3>
          <StatusStepper
            status={incident.status}
            onTransition={(next) => void handleTransition(next)}
            canTransition={mayTransition && !busy}
            disabledReason="Your role cannot change incident status."
          />
        </section>

        <section className="grid grid-cols-2 gap-4 rounded-lg border border-hairline bg-raised/40 p-3">
          <div>
            <p className="text-[11px] text-muted">Started</p>
            <p className="tabular mt-0.5 text-xs text-ink">{formatTimestamp(incident.startedAt)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">
              {incident.resolvedAt === null ? "Running for" : "Time to resolve"}
            </p>
            <p className="tabular mt-0.5 text-xs text-ink">
              {formatDuration(incidentDuration(incident, now))}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Impacted requests</p>
            <p className="tabular mt-0.5 text-xs text-ink">
              {formatCompact(incident.impactedRequests)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Source</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-ink">
              {incident.ruleId === null ? (
                "Declared manually"
              ) : (
                <>
                  <ShieldAlert aria-hidden="true" className="size-3 text-muted" />
                  Alert rule
                </>
              )}
            </p>
          </div>
        </section>

        <section>
          <Field
            label="Responder"
            description={
              mayAssign
                ? "Assignment is recorded on the timeline and notified to the routing integrations."
                : "Your role cannot assign responders."
            }
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={incident.assigneeId ?? ""}
                disabled={!mayAssign || busy}
                onChange={(event) => void handleAssign(event.target.value)}
              >
                <option value="">Unassigned</option>
                {assignableMembers(members).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.rotation ? ` — ${member.rotation}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</h3>
          <Timeline events={incident.timeline} now={now} />
        </section>

        {mayComment ? (
          <section className="flex flex-col gap-2">
            <Field
              label="Add a note"
              error={noteError}
              description="Notes are part of the post-mortem record. They cannot be edited afterwards."
            >
              {(fieldProps) => (
                <Textarea
                  {...fieldProps}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="What did you find, and what did you change?"
                  maxLength={2_000}
                />
              )}
            </Field>
            <Button
              variant="primary"
              size="sm"
              className="self-start"
              disabled={note.trim().length === 0}
              onClick={() => void handleNote()}
            >
              <MessageSquarePlus aria-hidden="true" className="size-3.5" />
              Post note
            </Button>
          </section>
        ) : (
          <p className="rounded-lg border border-hairline bg-raised/40 p-3 text-xs text-muted">
            Your role can read this incident but cannot post to its timeline.
          </p>
        )}
      </div>
    </Drawer>
  );
}
