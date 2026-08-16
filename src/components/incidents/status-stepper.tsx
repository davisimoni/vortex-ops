"use client";

import { Check, Lock } from "lucide-react";

import { allowedTransitions, INCIDENT_STATUSES, STATUS_LABEL, statusIndex } from "@/lib/incidents";
import { cn } from "@/lib/utils";
import type { IncidentStatus } from "@/types";

export interface StatusStepperProps {
  readonly status: IncidentStatus;
  readonly onTransition: (next: IncidentStatus) => void;
  /** `false` disables every step and explains why. */
  readonly canTransition: boolean;
  readonly disabledReason?: string;
}

/**
 * The incident lifecycle, as a stepper you can drive.
 *
 * Only *legal* next states are clickable. The transition table forbids jumping
 * Investigating → Resolved: an incident with no Identified step produces a
 * post-mortem timeline nobody can reconstruct, and the timeline is the reason
 * status is tracked at all.
 *
 * Illegal steps stay visible rather than being hidden — the reader needs to see
 * where the incident is in the whole lifecycle, not just where it can go next.
 */
export function StatusStepper({
  status,
  onTransition,
  canTransition,
  disabledReason,
}: StatusStepperProps) {
  const currentIndex = statusIndex(status);
  const nextStates = allowedTransitions(status);

  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Incident lifecycle">
      {INCIDENT_STATUSES.map((step, index) => {
        const isCurrent = step === status;
        const isPast = index < currentIndex;
        const isAllowed = canTransition && nextStates.includes(step);
        const interactive = isAllowed && !isCurrent;

        const title = isCurrent
          ? `Current status: ${STATUS_LABEL[step]}`
          : interactive
            ? `Move to ${STATUS_LABEL[step]}`
            : !canTransition
              ? (disabledReason ?? "You do not have permission to change status.")
              : `${STATUS_LABEL[status]} cannot move directly to ${STATUS_LABEL[step]}.`;

        return (
          <li key={step}>
            <button
              type="button"
              disabled={!interactive}
              onClick={() => onTransition(step)}
              title={title}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                isCurrent && "border-brand bg-brand/12 text-ink",
                !isCurrent && isPast && "border-hairline bg-raised text-ink2",
                !isCurrent && !isPast && "border-hairline text-muted",
                interactive && "cursor-pointer hover:border-brand hover:text-ink",
                !interactive && !isCurrent && "cursor-not-allowed opacity-60",
              )}
            >
              {isPast ? (
                <Check aria-hidden="true" className="size-3" />
              ) : isCurrent ? (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
              ) : !canTransition ? (
                <Lock aria-hidden="true" className="size-3" />
              ) : null}
              {STATUS_LABEL[step]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
