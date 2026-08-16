import { FileQuestion } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border border-hairline bg-raised">
        <FileQuestion aria-hidden="true" className="size-5 text-muted" />
      </span>
      <div>
        <h2 className="text-base font-semibold text-ink">Page not found</h2>
        <p className="mt-1 max-w-sm text-sm text-muted">
          That route does not exist in this workspace.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-contrast transition-opacity hover:opacity-90"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
