"use client";

import { AlertCircle, CheckCircle2, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { formatRelative, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AuditEventDto {
  readonly id: string;
  readonly at: number;
  readonly actorName: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly outcome: "success" | "denied" | "failure";
  readonly ip: string | null;
}

const OUTCOME_ICON = { success: CheckCircle2, denied: ShieldOff, failure: AlertCircle } as const;
const OUTCOME_TONE = { success: "good", denied: "warning", failure: "critical" } as const;

const ACTION_LABEL: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_out": "Signed out",
  "session.switch_organization": "Switched organisation",
  "incident.create": "Declared incident",
  "incident.transition": "Changed incident status",
  "incident.assign": "Assigned responder",
  "incident.comment": "Posted timeline note",
  "integration.create": "Created integration",
  "integration.update": "Updated integration",
  "integration.delete": "Removed integration",
  "integration.trigger": "Sent notification",
  "integration.test": "Sent test payload",
  "team.invite": "Invited member",
  "team.role_update": "Changed member role",
  "team.remove": "Removed member",
  "rbac.override": "Changed permission matrix",
  "compliance.export": "Exported compliance report",
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/**
 * The audit trail, read-only.
 *
 * Denials render alongside successes with equal visual weight — a log that
 * only shows what worked cannot answer "did anyone try", which is most of what
 * an access review is actually checking for.
 */
export function AuditLogCard() {
  const [events, setEvents] = useState<AuditEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<{ events: AuditEventDto[] }>("/api/audit?limit=50").then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.failure.message);
        return;
      }
      setEvents(result.data.events);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader
        title="Audit trail"
        subtitle="Every state change in this organisation, including refused attempts. Append-only — nothing here can be edited or deleted."
      />
      <CardBody>
        {error ? (
          <p className="text-sm text-crit">{error}</p>
        ) : events === null ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No audit events yet"
            body="Actions taken in this organisation — sign-ins, incident changes, integration edits — will appear here as they happen."
          />
        ) : (
          <ol className="flex flex-col divide-y divide-[var(--hairline)]">
            {events.map((event) => {
              const Icon = OUTCOME_ICON[event.outcome];
              return (
                <li key={event.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      event.outcome === "success" && "text-good",
                      event.outcome === "denied" && "text-warn",
                      event.outcome === "failure" && "text-crit",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium text-ink">{event.actorName}</span>
                      <span className="text-ink2">{actionLabel(event.action).toLowerCase()}</span>
                      {event.targetId ? (
                        <span className="tabular text-muted">{event.targetId}</span>
                      ) : null}
                      {event.outcome !== "success" ? (
                        <Badge tone={OUTCOME_TONE[event.outcome]}>{event.outcome}</Badge>
                      ) : null}
                    </p>
                    <p className="tabular mt-0.5 text-[11px] text-muted">
                      {formatRelative(event.at)} · {formatTimestamp(event.at)}
                      {event.ip ? ` · ${event.ip}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
