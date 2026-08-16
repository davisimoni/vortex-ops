"use client";

import { useEffect, useRef, useState } from "react";

import { logStreamFrameSchema, type LogEntry } from "@/lib/log-schema";
import type { StreamStatus } from "@/types";

const STREAM_URL = "/api/logs/stream";

/** Bounded client-side history — a terminal that never trims is a memory leak. */
const MAX_ENTRIES = 5_000;

/** Batches a burst of lines into one render instead of one state update per line. */
const FLUSH_MS = 80;

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface UseLogStreamResult {
  readonly entries: readonly LogEntry[];
  readonly status: StreamStatus;
  readonly clear: () => void;
}

/**
 * Subscribes to the live log SSE stream.
 *
 * Simpler than `useMetricStream`: there is no meaningful client-side fallback
 * for "logs the server never sent" — a simulated log line would be actively
 * misleading in an operational tool, so on a dropped connection this only
 * reports the state truthfully and lets `EventSource` retry on its own.
 *
 * `paused` freezes the *displayed* list without tearing down the connection,
 * so nothing is missed while the viewer is stopped — matching the pause
 * semantics on the metrics dashboard.
 */
export function useLogStream(paused: boolean): UseLogStreamResult {
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;
    let pendingBuffer: LogEntry[] = [];
    let flushTimer: number | null = null;

    const flush = (): void => {
      flushTimer = null;
      if (disposed || pendingBuffer.length === 0) return;
      const incoming = pendingBuffer;
      pendingBuffer = [];
      setEntries((current) => {
        const next = [...current, ...incoming];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    };

    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      flushTimer = window.setTimeout(flush, FLUSH_MS);
    };

    const ingest = (entry: LogEntry): void => {
      if (disposed) return;
      // Paused means "stop updating the view", not "stop receiving" — the
      // connection stays open so nothing is lost once resumed.
      if (pausedRef.current) return;
      pendingBuffer.push(entry);
      scheduleFlush();
    };

    const connect = (): void => {
      if (disposed) return;

      if (document.readyState !== "complete") {
        window.addEventListener("load", connect, { once: true });
        return;
      }

      setStatus("connecting");
      source = new EventSource(STREAM_URL);

      source.onopen = () => {
        if (!disposed) setStatus("live");
      };

      source.onmessage = (event: MessageEvent<string>) => {
        const parsed = logStreamFrameSchema.safeParse(safeJsonParse(event.data));
        if (!parsed.success) {
          console.warn("[vortex] dropped malformed log frame");
          return;
        }
        if (parsed.data.type === "backlog") {
          if (disposed) return;
          setEntries(parsed.data.entries.slice(-MAX_ENTRIES));
          return;
        }
        ingest(parsed.data.entry);
      };

      source.onerror = () => {
        if (!disposed) setStatus("reconnecting");
      };
    };

    connect();

    return () => {
      disposed = true;
      window.removeEventListener("load", connect);
      source?.close();
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, []);

  return { entries, status, clear: () => setEntries([]) };
}
