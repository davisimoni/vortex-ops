"use client";

import { useEffect, useRef } from "react";

import { streamFrameSchema } from "@/lib/metric-schema";
import { mulberry32, nextPoint } from "@/lib/metrics";
import { useMetricsStore } from "@/store/metrics-store";
import type { MetricPoint } from "@/types";

const STREAM_URL = "/api/metrics/stream";
const FALLBACK_TICK_MS = 2_000;

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Subscribes to the server-sent metric stream.
 *
 * SSE rather than WebSockets: the traffic is one-directional, and SSE reconnects
 * on its own, survives HTTP/2 multiplexing and needs no protocol upgrade at the
 * proxy. A WebSocket here would be more moving parts for a feature that only
 * ever pushes.
 *
 * If the stream cannot be established — the connection drops, or the runtime has
 * no EventSource — the hook falls back to generating samples locally so the
 * dashboard keeps moving. The connection badge switches to "Simulated" so nobody
 * mistakes simulated continuity for live data.
 */
export function useMetricStream(onSample?: (point: MetricPoint) => void): void {
  const applySample = useMetricsStore((state) => state.applySample);
  const setStatus = useMetricsStore((state) => state.setStatus);

  // The callback is held in a ref so a new inline function on every render does
  // not tear down and re-open the connection. The ref is written in its own
  // effect rather than during render — a ref mutated mid-render can be read by
  // a torn render pass under concurrent rendering.
  const onSampleRef = useRef(onSample);
  useEffect(() => {
    onSampleRef.current = onSample;
  }, [onSample]);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallbackTimer: number | null = null;
    let disposed = false;

    const handlePoint = (point: MetricPoint): void => {
      if (disposed) return;
      applySample(point);
      onSampleRef.current?.(point);
    };

    const stopFallback = (): void => {
      if (fallbackTimer === null) return;
      window.clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    const startFallback = (): void => {
      if (fallbackTimer !== null || disposed) return;
      setStatus("offline");
      const rng = mulberry32(Date.now() & 0xffff);

      fallbackTimer = window.setInterval(() => {
        const { series } = useMetricsStore.getState();
        const previous = series[series.length - 1];
        if (!previous) return;
        handlePoint(nextPoint(previous, Date.now(), rng));
      }, FALLBACK_TICK_MS);
    };

    const attach = (stream: EventSource): void => {
      stream.onopen = () => {
        if (disposed) return;
        stopFallback();
        setStatus("live");
      };

      stream.onmessage = (event: MessageEvent<string>) => {
        const parsed = streamFrameSchema.safeParse(safeJsonParse(event.data));
        if (!parsed.success) {
          // One bad frame is not a reason to tear down a working stream.
          console.warn("[vortex] dropped malformed metric frame");
          return;
        }
        handlePoint(parsed.data.point);
      };

      stream.onerror = () => {
        if (disposed) return;
        // EventSource retries on its own; the fallback only covers the gap so
        // the charts keep advancing while it does.
        setStatus("reconnecting");
        startFallback();
      };
    };

    /**
     * Opens the stream, deferring until the document has finished loading.
     *
     * A connection that never ends keeps the browser's `load` event pending for
     * as long as it is open. Opening it during page load therefore leaves the
     * page permanently "loading": the tab spinner never stops, `window.onload`
     * handlers never run, and anything that waits on load hangs. It also
     * competes with the page's own resources for the per-origin connection
     * budget. Waiting costs nothing — the first sample is a tick away regardless.
     */
    const connect = (): void => {
      if (disposed) return;

      if (document.readyState !== "complete") {
        window.addEventListener("load", connect, { once: true });
        return;
      }

      source = new EventSource(STREAM_URL);
      attach(source);
    };

    if (typeof EventSource === "undefined") {
      startFallback();
    } else {
      setStatus("connecting");
      connect();
    }

    return () => {
      disposed = true;
      window.removeEventListener("load", connect);
      source?.close();
      stopFallback();
    };
  }, [applySample, setStatus]);
}
