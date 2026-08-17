"use client";

import { AlertTriangle, ArrowRight, Building2, CornerDownLeft, Search, Siren, Skull } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { NAV_ITEMS } from "@/components/layout/nav-items";
import { useSession } from "@/components/system/session-provider";
import { apiPost } from "@/lib/api-client";
import { filterCommands, type SearchableCommand } from "@/lib/command-palette";
import { effectivePermissions, type Permission } from "@/lib/rbac";
import { serviceName } from "@/lib/services";
import { cn } from "@/lib/utils";
import { useCommandPaletteStore } from "@/store/command-palette-store";
import { useIncidentStore } from "@/store/incident-store";
import { useMetricsStore } from "@/store/metrics-store";
import { usePreviewStore } from "@/store/session-store";
import { useToastStore } from "@/store/toast-store";

/**
 * Global command palette — `⌘K` / `Ctrl+K` from anywhere in the authenticated
 * app.
 *
 * A hand-rolled dialog rather than `cmdk`: this app already has the exact
 * primitives a command palette needs (focus trap, Escape-to-close, backdrop —
 * see `Modal`/`Drawer`), and the interesting part of this component is the
 * command list and the chaos-drill confirm step, not dialog plumbing a
 * dependency would otherwise own. Pulling in a library to re-solve what two
 * existing files already solve would be net-negative bundle for no new
 * capability.
 */

interface Command extends SearchableCommand {
  readonly section: "Pages" | "Active incidents" | "Switch organization" | "Actions";
  readonly description?: string;
  readonly icon: ReactNode;
  readonly run: () => void;
}

const SECTION_ORDER: readonly Command["section"][] = [
  "Actions",
  "Active incidents",
  "Pages",
  "Switch organization",
];

export function CommandPalette() {
  const session = useSession();
  const router = useRouter();
  const pushToast = useToastStore((state) => state.push);

  const previewRole = usePreviewStore((state) => state.previewRole);
  const overrides = usePreviewStore((state) => state.overrides);
  const permissions = useMemo<readonly Permission[]>(
    () => (previewRole === null ? session.permissions : effectivePermissions(previewRole, overrides)),
    [previewRole, overrides, session.permissions],
  );

  const incidents = useIncidentStore((state) => state.incidents);
  const selectIncident = useIncidentStore((state) => state.select);
  const triggerChaos = useIncidentStore((state) => state.triggerChaos);
  const triggerSpike = useMetricsStore((state) => state.triggerChaosSpike);

  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const toggleOpen = useCommandPaletteStore((state) => state.toggle);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [confirmingChaos, setConfirmingChaos] = useState(false);
  const [runningChaos, setRunningChaos] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setConfirmingChaos(false);
  }, [setOpen]);

  // Global shortcut, from anywhere — the whole point of a command palette is
  // never having to reach for the mouse or the sidebar first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleOpen();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggleOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const runChaosDrill = async (): Promise<void> => {
    setRunningChaos(true);
    const result = await triggerChaos();
    setRunningChaos(false);
    close();

    if (!result.ok || !result.incident) {
      pushToast({
        tone: "warning",
        title: "Drill did not start",
        ...(result.message ? { body: result.message } : {}),
      });
      return;
    }

    triggerSpike(result.spikeDurationMs);
    pushToast({
      tone: "critical",
      title: "Chaos drill started",
      body: `${result.incident.title} — notifications sent to every subscribed integration.`,
    });
  };

  const switchOrganization = async (organizationId: string): Promise<void> => {
    close();
    const result = await apiPost<{ organization: { id: string } }>("/api/session/organization", {
      organizationId,
    });
    if (!result.ok) {
      pushToast({ tone: "warning", title: "Could not switch organisation", body: result.failure.message });
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload needed, see OrgSwitcher
    window.location.assign("/dashboard");
  };

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    if (permissions.includes("chaos:trigger")) {
      list.push({
        id: "action:chaos",
        section: "Actions",
        label: "Trigger Chaos Drill",
        description: "Opens a real critical incident and notifies your integrations",
        keywords: ["chaos", "drill", "simulate", "failure"],
        icon: <Skull aria-hidden="true" className="size-4 text-crit" />,
        run: () => setConfirmingChaos(true),
      });
    }

    for (const incident of incidents) {
      if (incident.status === "resolved") continue;
      list.push({
        id: `incident:${incident.id}`,
        section: "Active incidents",
        label: incident.title,
        description: `${incident.id} · ${serviceName(incident.serviceId)}`,
        keywords: [incident.id, incident.serviceId, incident.severity],
        icon: <Siren aria-hidden="true" className="size-4 text-crit" />,
        run: () => {
          selectIncident(incident.id);
          close();
          router.push("/incidents");
        },
      });
    }

    for (const item of NAV_ITEMS) {
      if (!permissions.includes(item.permission)) continue;
      list.push({
        id: `page:${item.href}`,
        section: "Pages",
        label: item.label,
        description: item.description,
        keywords: [item.href],
        icon: <item.icon aria-hidden="true" className="size-4 text-muted" />,
        run: () => {
          close();
          router.push(item.href);
        },
      });
    }

    for (const org of session.organizations) {
      if (org.id === session.organization.id) continue;
      list.push({
        id: `org:${org.id}`,
        section: "Switch organization",
        label: `Switch to ${org.name}`,
        keywords: [org.slug],
        icon: <Building2 aria-hidden="true" className="size-4 text-muted" />,
        run: () => void switchOrganization(org.id),
      });
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close/router/selectIncident/switchOrganization are stable enough for a palette rebuilt on every relevant data change
  }, [permissions, incidents, session.organizations, session.organization.id]);

  const filtered = filterCommands(commands, query);
  const bySection = SECTION_ORDER.map((section) => ({
    section,
    items: filtered.filter((command) => command.section === section),
  })).filter((group) => group.items.length > 0);

  const handleQueryChange = (value: string): void => {
    setQuery(value);
    // Reset here, not in an effect keyed on `query`: the highlighted row has
    // to track the *new* filtered list the moment it changes, and a separate
    // effect would apply the reset one render behind, plus cost a second
    // cascading render for something this handler can just do directly.
    setActiveIndex(0);
  };

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (confirmingChaos) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setConfirmingChaos(false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void runChaosDrill();
      }
      return;
    }

    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      filtered[activeIndex]?.run();
    }
  };

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close command palette"
        onClick={close}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
        className="animate-slide-in relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-2xl"
      >
        {confirmingChaos ? (
          <div className="flex flex-col gap-3 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <AlertTriangle aria-hidden="true" className="size-4 text-crit" />
              Trigger a real chaos drill?
            </p>
            <p className="text-xs leading-relaxed text-muted">
              This opens a real critical incident and notifies every subscribed integration. Press Enter
              to confirm, or Escape to cancel.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={runningChaos}
                onClick={() => void runChaosDrill()}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-crit px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {runningChaos ? "Starting…" : "Confirm drill"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingChaos(false)}
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-ink2 hover:bg-raised"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search pages, incidents, actions…"
                aria-label="Search commands"
                aria-activedescendant={filtered[activeIndex] ? `command-${filtered[activeIndex].id}` : undefined}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                className="h-6 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
              />
              <kbd className="hidden rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] text-muted sm:block">
                Esc
              </kbd>
            </div>

            <div id="command-palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted">No matching commands.</p>
              ) : (
                bySection.map((group) => (
                  <div key={group.section} className="mb-1 last:mb-0">
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {group.section}
                    </p>
                    {group.items.map((command) => {
                      flatIndex += 1;
                      const active = flatIndex === activeIndex;
                      return (
                        <button
                          key={command.id}
                          id={`command-${command.id}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => command.run()}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                            active ? "bg-brand/10 text-ink" : "text-ink2 hover:bg-raised",
                          )}
                        >
                          {command.icon}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{command.label}</span>
                            {command.description ? (
                              <span className="block truncate text-xs text-muted">{command.description}</span>
                            ) : null}
                          </span>
                          {active ? (
                            <CornerDownLeft aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                          ) : (
                            <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-transparent" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
