import { recentLogEntries, subscribeToLogs, type LogEntry } from "@/lib/log-buffer";
import type { LogStreamFrame } from "@/lib/log-schema";
import { requestLogger } from "@/lib/logger";
import { authErrorResponse, requirePermission } from "@/server/session/context";

/**
 * Server-sent live log stream — same shape as `/api/metrics/stream`, gated
 * behind `logs:read`.
 *
 * Unlike the metrics stream, this one is genuinely sensitive: raw process
 * logs can carry request paths, hostnames and internal error detail (never
 * secrets — the logger redacts those before a line ever reaches the buffer —
 * but still more than a dashboard viewer needs). The permission check runs
 * before the stream opens, using the same cookie-based session every other
 * route reads; `EventSource` cannot set an Authorization header, but it does
 * send same-origin cookies automatically, so this needs no separate scheme.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INITIAL_BACKLOG = 500;
const MAX_CONNECTION_MS = 5 * 60_000;

export async function GET(request: Request): Promise<Response> {
  try {
    await requirePermission("logs:read");
  } catch (error) {
    const mapped = authErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }

  const log = requestLogger(request, "/api/logs/stream");
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (frame: LogStreamFrame): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      const shutdown = (reason: string): void => {
        if (closed) return;
        closed = true;
        clearTimeout(lifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* Already closed by the platform. */
        }
        log.info("Log stream closed", { reason });
      };

      safeEnqueue({ type: "backlog", entries: recentLogEntries(INITIAL_BACKLOG) });

      const unsubscribe = subscribeToLogs((entry: LogEntry) => {
        if (!safeEnqueue({ type: "entry", entry })) shutdown("enqueue-failed");
      });

      // Serverless platforms cap invocation duration regardless; closing on our
      // own terms means the browser sees a clean `close` it reconnects from,
      // rather than a socket the platform kills mid-frame.
      const lifetime = setTimeout(() => shutdown("max-duration"), MAX_CONNECTION_MS);

      request.signal.addEventListener("abort", () => shutdown("client-abort"), { once: true });

      log.info("Log stream opened");
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
      "X-Accel-Buffering": "no",
    },
  });
}
