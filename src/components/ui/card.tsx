import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Controls, legends or a table-view toggle. Right-aligned on wide screens. */
  readonly actions?: ReactNode;
  readonly className?: string;
  /** Heading level, so a page's outline stays correct. */
  readonly as?: "h2" | "h3";
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
  as: Heading = "h2",
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-hairline px-4 py-3.5",
        "sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-sm font-semibold tracking-tight text-ink">{title}</Heading>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}
