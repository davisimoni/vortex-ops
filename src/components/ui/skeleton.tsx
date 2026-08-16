import { cn } from "@/lib/utils";

/**
 * Placeholder block.
 *
 * Used for the first paint only. Refetches hold the previous render at reduced
 * opacity instead — swapping live content for a skeleton on every update makes
 * a dashboard flash, and the reader loses their place.
 */
export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-[var(--raised)]", className)}
    />
  );
}

export function ChartSkeleton({ height = 220 }: { readonly height?: number }) {
  return (
    <div className="flex flex-col gap-3" style={{ height }} aria-hidden="true">
      <div className="flex gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="flex-1 rounded-lg" />
    </div>
  );
}
