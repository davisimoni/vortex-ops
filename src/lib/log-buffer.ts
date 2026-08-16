import type { LogLevel } from "@/lib/logger";

/**
 * In-process ring buffer of everything the structured logger has emitted,
 * plus a pub/sub fan-out for the live tail.
 *
 * Same scope note as `rate-limit.ts`: one instance per process, not a
 * distributed log store. Behind several replicas each holds only its own
 * recent history — acceptable for what this powers (an in-app live tail for
 * whoever is looking at this specific instance), and the honest alternative
 * in production is shipping to Datadog/Loki/CloudWatch, which the logger's
 * newline-delimited JSON output is already designed for.
 */

export interface LogEntry {
  /** Monotonic within this process — lets the viewer detect gaps after a reconnect. */
  readonly id: number;
  readonly capturedAt: string;
  readonly level: LogLevel;
  /** The exact line the logger sink emitted — JSON or pretty, whichever is configured. */
  readonly line: string;
}

/** Bounded so a noisy process cannot grow this without limit. */
const MAX_ENTRIES = 2_000;

let sequence = 0;
const entries: LogEntry[] = [];

type Listener = (entry: LogEntry) => void;
const listeners = new Set<Listener>();

/** Called from the logger's sink — every emitted line passes through here. */
export function pushLogEntry(line: string, level: LogLevel): LogEntry {
  sequence += 1;
  const entry: LogEntry = { id: sequence, capturedAt: new Date().toISOString(), level, line };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // One broken subscriber (a dropped SSE connection mid-write) must not
      // stop every other viewer's stream, or logging itself, from working.
    }
  }

  return entry;
}

/** Most recent entries, oldest first — the backlog a newly opened viewer needs. */
export function recentLogEntries(limit = MAX_ENTRIES): LogEntry[] {
  const bounded = Math.max(0, Math.min(limit, entries.length));
  return entries.slice(entries.length - bounded);
}

/** Live tail. Returns an unsubscribe function. */
export function subscribeToLogs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam — the module-level buffer would otherwise leak between test cases. */
export function resetLogBuffer(): void {
  entries.length = 0;
  sequence = 0;
  listeners.clear();
}
