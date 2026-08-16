import { AlertTriangle, CheckCircle2, CircleDot, Flame, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { IncidentSeverity, IncidentStatus } from "@/types";
import { SEVERITY_LABEL, STATUS_LABEL } from "@/lib/incidents";

/**
 * Status badges.
 *
 * Every one pairs an icon with a text label. Status colour never carries the
 * meaning on its own — under deuteranopia the amber "warning" and the red
 * "critical" chips are close enough that colour alone would be a coin flip.
 */

export type BadgeTone = "neutral" | "good" | "warning" | "serious" | "critical" | "brand";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-hairline text-ink2 bg-raised",
  good: "border-good/35 text-ink bg-good/10",
  warning: "border-warn/45 text-ink bg-warn/12",
  serious: "border-serious/45 text-ink bg-serious/12",
  critical: "border-crit/45 text-ink bg-crit/12",
  brand: "border-brand/40 text-ink bg-brand/10",
};

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-[var(--ink-muted)]",
  good: "bg-good",
  warning: "bg-warn",
  serious: "bg-serious",
  critical: "bg-crit",
  brand: "bg-brand",
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly icon?: LucideIcon;
  /** Shows a colour dot instead of an icon. */
  readonly dot?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Badge({ tone = "neutral", icon: Icon, dot = false, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5",
        "text-xs font-medium leading-5",
        TONE[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      {!Icon && dot ? (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />
      ) : null}
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<IncidentSeverity, BadgeTone> = {
  critical: "critical",
  major: "serious",
  warning: "warning",
};

const SEVERITY_ICON: Record<IncidentSeverity, LucideIcon> = {
  critical: Flame,
  major: AlertTriangle,
  warning: CircleDot,
};

export function SeverityBadge({ severity }: { readonly severity: IncidentSeverity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} icon={SEVERITY_ICON[severity]}>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

const STATUS_TONE: Record<IncidentStatus, BadgeTone> = {
  investigating: "critical",
  identified: "serious",
  monitoring: "warning",
  resolved: "good",
};

export function StatusBadge({ status }: { readonly status: IncidentStatus }) {
  return (
    <Badge
      tone={STATUS_TONE[status]}
      {...(status === "resolved" ? { icon: CheckCircle2 } : { dot: true })}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
