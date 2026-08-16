import { requestLogger } from "@/lib/logger";
import { generateSeries, mulberry32, nextPoint } from "@/lib/metrics";
import type { StreamFrame } from "@/lib/metric-schema";
import type { MetricPoint } from "@/types";

/**
 * Server-sent metric stream.
 *
 * `force-dynamic` and the Node runtime are both required: a cached response or
 * an edge runtime that buffers would turn a live stream into a single frame
 * delivered whenever the buffer flushes.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TICK_MS = 2_000;

/**
 * Connections are closed after five minutes and the client reconnects.
 *
 * Serverless platforms cap invocation duration anyway; closing deliberately
 * means the shutdown is a clean `close` the browser retries, rather than a
 * socket the platform kills mid-frame.
 */
const MAX_CONNECTION_MS = 5 * 60_000;

export function GET(request: Request): Response {
  const log = requestLogger(request, "/api/metrics/stream");
  const encoder = new TextEncoder();

  // Seeded from the same generator as the client's initial history, so the
  // first streamed sample continues the series instead of jumping.
  const history = generateSeries("1h", { seed: 1_337 });
  let previous: MetricPoint = history[history.length - 1] ?? {
    t: Date.now(),
    latencyP50: 96,
    latencyP95: 202,
    latencyP99: 290,
    cpu: 38,
    errorRate: 0.08,
    throughput: 7_800,
  };

  const rng = mulberry32(Date.now() & 0xffff);
  let seq = 0;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // The consumer went away between the abort event and this tick.
          closed = true;
          return false;
        }
      };

      const shutdown = (reason: string): void => {
        if (closed) return;
        closed = true;
        clearInterval(ticker);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          /* Already closed by the platform. */
        }
        log.info("Metric stream closed", { reason, frames: seq });
      };

      // `retry` tells the browser how long to wait before reconnecting; without
      // it EventSource uses its own default, which varies by engine.
      safeEnqueue(`retry: ${TICK_MS}\n\n`);

      const ticker = setInterval(() => {
        previous = nextPoint(previous, Date.now(), rng);
        seq += 1;

        const frame: StreamFrame = { type: "sample", point: previous, seq };
        if (!safeEnqueue(`data: ${JSON.stringify(frame)}\n\n`)) shutdown("enqueue-failed");
      }, TICK_MS);

      const lifetime = setTimeout(() => shutdown("max-duration"), MAX_CONNECTION_MS);

      request.signal.addEventListener("abort", () => shutdown("client-abort"), { once: true });

      log.info("Metric stream opened", { tickMs: TICK_MS });
    },

    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which would defeat SSE.
      "X-Accel-Buffering": "no",
    },
  });
}
