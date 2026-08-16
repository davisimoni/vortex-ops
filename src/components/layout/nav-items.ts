import { Activity, PlugZap, ShieldCheck, Siren, Terminal, type LucideIcon } from "lucide-react";

import type { Permission } from "@/lib/rbac";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
  /** Permission required to see the entry at all. */
  readonly permission: Permission;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: Activity,
    description: "Live system metrics",
    permission: "metrics:read",
  },
  {
    href: "/incidents",
    label: "Incidents",
    icon: Siren,
    description: "Alerting and response",
    permission: "incident:read",
  },
  {
    href: "/integrations",
    label: "Integrations",
    icon: PlugZap,
    description: "Webhooks and routing",
    permission: "integration:read",
  },
  {
    href: "/dashboard/logs",
    label: "Logs",
    icon: Terminal,
    description: "Live process log tail",
    permission: "logs:read",
  },
  {
    href: "/settings/team",
    label: "Team & access",
    icon: ShieldCheck,
    description: "Members and roles",
    permission: "team:read",
  },
] as const;

/**
 * The nav item that best matches a path, or `null`.
 *
 * "Best" means longest `href` match, not first: `/dashboard/logs` starts with
 * both `/dashboard` and `/dashboard/logs`, and without preferring the longer,
 * more specific match, the Dashboard entry would win by array order alone —
 * highlighting two rows at once and mislabelling the page title.
 */
export function matchNavItem(pathname: string, items: readonly NavItem[] = NAV_ITEMS): NavItem | null {
  let best: NavItem | null = null;

  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) continue;
    if (best === null || item.href.length > best.href.length) best = item;
  }

  return best;
}
