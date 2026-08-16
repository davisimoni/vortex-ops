"use client";

import { Waves, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { matchNavItem, NAV_ITEMS } from "@/components/layout/nav-items";
import { usePermission } from "@/components/system/session-provider";
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/rbac";

export interface SidebarProps {
  /** Mobile drawer state. Ignored at `lg` and above, where the rail is static. */
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * One nav link, gated by its own permission.
 *
 * A component rather than an inline map body: `usePermission` is a hook, and
 * calling a hook conditionally inside `.map()` (skipping the ones the JSX
 * would filter out) breaks the rules of hooks the moment the permission set
 * changes size between renders.
 */
function NavLink({
  item,
  active,
  onClick,
}: {
  readonly item: (typeof NAV_ITEMS)[number];
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const allowed = usePermission(item.permission as Permission);
  if (!allowed) return null;

  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active ? "bg-brand/10 font-medium text-ink" : "text-ink2 hover:bg-raised hover:text-ink",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted")} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {active ? <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" /> : null}
    </Link>
  );
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const activeHref = matchNavItem(pathname)?.href ?? null;

  const nav = (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 px-3 py-3">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} active={item.href === activeHref} onClick={onClose} />
      ))}
    </nav>
  );

  const brand = (
    <div className="flex h-14 items-center gap-2.5 border-b border-hairline px-4">
      <span className="flex size-7 items-center justify-center rounded-lg bg-brand">
        <Waves aria-hidden="true" className="size-4 text-brand-contrast" />
      </span>
      <span className="text-sm font-semibold tracking-tight text-ink">Vortex Ops</span>
    </div>
  );

  const footer = (
    <div className="border-t border-hairline px-4 py-3">
      <p className="text-[11px] leading-relaxed text-muted">
        Region <span className="tabular text-ink2">{process.env.NEXT_PUBLIC_REGION ?? "eu-central-1"}</span>
        <br />
        {/* Same value /api/health reports, so a bug report and the probe agree. */}
        Build <span className="tabular text-ink2">v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
      </p>
    </div>
  );

  return (
    <>
      {/* Static rail — large screens only. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-surface lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* Mobile drawer. */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="absolute inset-0 bg-black/45"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="animate-slide-in relative flex h-full w-64 flex-col border-r border-hairline bg-surface"
          >
            <div className="flex h-14 items-center justify-between gap-2 border-b border-hairline px-4">
              <span className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-brand">
                  <Waves aria-hidden="true" className="size-4 text-brand-contrast" />
                </span>
                <span className="text-sm font-semibold tracking-tight text-ink">Vortex Ops</span>
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      ) : null}
    </>
  );
}
