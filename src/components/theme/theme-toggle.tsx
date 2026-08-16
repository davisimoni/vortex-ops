"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "vortex-theme";

/**
 * Runs before first paint, inlined in <head>.
 *
 * Without it the page renders in the light palette and then repaints dark on
 * hydration — a full-screen white flash on every navigation for anyone using
 * dark mode, which on an on-call dashboard at 3am is a real complaint.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored !== 'light' && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (error) {
    /* Private-mode storage throws. A light default is a fine fallback. */
  }
})();
`.trim();

function applyTheme(preference: ThemePreference): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = preference === "dark" || (preference === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/* -------------------------------------------------------------------------- */
/* localStorage as an external store                                           */
/* -------------------------------------------------------------------------- */

/*
 * The stored preference is external state, so it is read with
 * `useSyncExternalStore` rather than copied into React state inside an effect.
 * Two things fall out for free: no cascading render on mount, and the `storage`
 * event keeps a second tab in sync when the choice changes.
 */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private-mode storage throws on access, not only on write.
    return "system";
  }
}

/** The server has no storage, so it always renders the neutral default. */
function serverPreference(): ThemePreference {
  return "system";
}

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribePreference,
    readPreference,
    serverPreference,
  );

  // Following the OS is a live subscription, not a one-off read: the setting can
  // change while the tab is open (macOS auto-switches at sunset).
  useEffect(() => {
    if (preference !== "system") return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Storage unavailable — the choice still applies for this session. */
    }
    applyTheme(next);
    // `storage` only fires in *other* tabs, so this tab is notified explicitly.
    notify();
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-hairline bg-raised p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        // During hydration this reads the server snapshot ("system") and
        // corrects itself in the same commit — no mismatch, no extra render.
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={label}
            onClick={() => choose(value)}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              selected ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
