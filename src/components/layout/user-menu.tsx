"use client";

import { ExternalLink, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useIsPreviewing, useSession } from "@/components/system/session-provider";
import { apiPost } from "@/lib/api-client";
import { initials } from "@/lib/format";
import { ROLE_DEFINITIONS } from "@/lib/rbac";
import { cn } from "@/lib/utils";

export function UserMenu() {
  const session = useSession();
  const previewing = useIsPreviewing();

  const [open, setOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  /**
   * Clears the current session and lands on the real sign-in picker.
   *
   * There is no "just sign out" any more — `(app)/layout.tsx` re-provisions a
   * fresh demo session for anyone with no cookie, so the only meaningful
   * outcome of clearing this one is landing somewhere you can pick a
   * *specific* identity instead (a DevOps or Viewer role, or a different
   * organisation) rather than the default Owner-at-Acme guest.
   */
  const switchAccount = async (): Promise<void> => {
    setSwitchingAccount(true);
    await apiPost("/api/auth/sign-out", {});
    // Hard navigation: it must land past the authenticated layout's server-side
    // session check, which a client-side route change would not re-evaluate.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional, see above
    window.location.assign("/sign-in");
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        // The name/role text is visually hidden below `md`, which removes it
        // from the accessibility tree too (`display: none`, not just clipped).
        // Without an explicit label the trigger would have no accessible name
        // at all on a phone — exactly where most of this app's users are.
        aria-label={`Account menu — ${session.user.name}, ${ROLE_DEFINITIONS[session.role].label}`}
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-raised"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-[11px] font-semibold",
            previewing ? "bg-warn/20 text-ink" : "bg-brand/15 text-ink",
          )}
        >
          {initials(session.user.name)}
        </span>
        <span className="hidden text-xs leading-tight md:block">
          <span className="block font-medium text-ink">{session.user.name}</span>
          <span className="block text-muted">{ROLE_DEFINITIONS[session.role].label}</span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-hairline bg-surface py-1 shadow-[var(--shadow-card)]"
        >
          <div className="border-b border-hairline px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{session.user.name}</p>
            <p className="truncate text-xs text-muted">{session.user.email}</p>
          </div>
          <a
            href={`/status/${session.organization.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-raised"
          >
            <ExternalLink aria-hidden="true" className="size-3.5 text-muted" />
            View public status page
          </a>
          <button
            type="button"
            role="menuitem"
            disabled={switchingAccount}
            onClick={() => void switchAccount()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-raised disabled:opacity-60"
          >
            <LogOut aria-hidden="true" className="size-3.5 text-muted" />
            {switchingAccount ? "Switching…" : "Switch account"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
