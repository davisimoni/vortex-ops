import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}

/**
 * The "nothing here" state.
 *
 * Always says *why* it is empty and what to do next. A bare "No results" leaves
 * the reader unable to tell a working filter from a broken page.
 */
export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full border border-hairline bg-raised">
        <Icon aria-hidden="true" className="size-4.5 text-muted" />
      </span>
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
