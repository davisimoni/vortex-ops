"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSession } from "@/components/system/session-provider";
import { apiPost } from "@/lib/api-client";
import { ENVIRONMENT_LABEL } from "@/lib/session";
import { cn } from "@/lib/utils";

const ENV_DOT: Record<string, string> = {
  production: "bg-good",
  staging: "bg-warn",
  development: "bg-brand",
};

/**
 * Organisation switcher.
 *
 * This is the multi-tenancy boundary made visible: switching here is the only
 * way the active organisation changes, and every fetch on every page is scoped
 * to whichever one is selected. Selecting Stark and seeing Acme's incidents for
 * even one frame would be the isolation bug that ends the trial.
 *
 * A real navigation, not client-side state. The new organisation comes with a
 * different role and a different permission set, and every server component in
 * the tree below the layout needs to re-render against the new session cookie —
 * a client-only switch would leave server-rendered parts of the page stale.
 */
export function OrgSwitcher() {
  const session = useSession();

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onClickOutside = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const switchTo = async (organizationId: string): Promise<void> => {
    if (organizationId === session.organization.id) {
      setOpen(false);
      return;
    }

    setSwitching(organizationId);
    setError(null);

    const result = await apiPost<{ organization: { id: string } }>("/api/session/organization", {
      organizationId,
    });

    if (!result.ok) {
      setSwitching(null);
      setError(result.failure.message);
      return;
    }

    // Full reload, deliberately: every server component down the tree — the
    // layout's session read, every page's data fetch — has to see the new
    // cookie, and a router.refresh() races the cookie write on some browsers.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional, see above
    window.location.assign("/dashboard");
  };

  if (session.organizations.length <= 1) {
    // Nothing to switch to. Still shows the tenant name — the reader should
    // always be able to see which organisation's data is on screen.
    return (
      <span className="hidden items-center gap-1.5 rounded-lg border border-hairline bg-raised px-2.5 py-1.5 text-xs font-medium text-ink2 sm:flex">
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", ENV_DOT[session.organization.environment])} />
        {session.organization.name}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-hairline bg-raised px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-hairline-strong"
      >
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", ENV_DOT[session.organization.environment])} />
        <span className="max-w-[9rem] truncate sm:max-w-[12rem]">
          {session.organization.name}{" "}
          <span className="text-muted">({ENVIRONMENT_LABEL[session.organization.environment]})</span>
        </span>
        {switching ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-muted" />
        ) : (
          <ChevronsUpDown aria-hidden="true" className="size-3.5 text-muted" />
        )}
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Switch organisation"
          className="absolute right-0 z-40 mt-1.5 w-72 overflow-hidden rounded-xl border border-hairline bg-surface py-1 shadow-[var(--shadow-card)]"
        >
          {session.organizations.map((org) => {
            const selected = org.id === session.organization.id;
            return (
              <button
                key={org.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={switching !== null}
                onClick={() => void switchTo(org.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  "hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", ENV_DOT[org.environment])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{org.name}</span>
                  <span className="block text-[11px] text-muted">
                    {ENVIRONMENT_LABEL[org.environment]} · {org.slug}
                  </span>
                </span>
                {selected ? <Check aria-hidden="true" className="size-4 shrink-0 text-brand" /> : null}
                {switching === org.id ? (
                  <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted" />
                ) : null}
              </button>
            );
          })}

          {error ? <p className="border-t border-hairline px-3 py-2 text-xs text-crit">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
