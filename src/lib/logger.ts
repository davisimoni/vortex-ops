import { pushLogEntry } from "@/lib/log-buffer";

/**
 * Structured JSON logger.
 *
 * One JSON object per line, so anything that ingests newline-delimited JSON
 * (Datadog, Loki, CloudWatch, `jq`) can parse it without a custom grok pattern.
 *
 * Two rules the rest of the codebase depends on:
 *  1. Field names are stable. `msg`, `level`, `ts`, `service` never get renamed —
 *     dashboards and alert queries are written against them.
 *  2. Nothing sensitive is ever written. `redact()` walks the payload and masks
 *     known-secret keys before serialisation, so a caller that accidentally
 *     spreads a whole request object into the log does not leak an auth header.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Values a log field may carry. Functions and symbols are not serialisable. */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogValue[]
  | { [key: string]: LogValue };

export type LogContext = Record<string, LogValue>;

export interface LogRecord extends LogContext {
  ts: string;
  level: LogLevel;
  msg: string;
  service: string;
  env: string;
}

/**
 * Keys whose values are masked before a record is serialised. Matched
 * case-insensitively against the *whole* key, plus a substring pass for the
 * compound names that show up in practice (`metaAccessToken`, `x-api-key`).
 */
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|credential|signature|bearer|private[-_]?key)/i;

/** Values that look like a bearer token or a signed payload, wherever they appear. */
const SENSITIVE_VALUE_PATTERN = /^(Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|xox[baprs]-\S+)$/;

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…[+${value.length - MAX_STRING_LENGTH} chars]`
    : value;
}

/**
 * Recursively masks sensitive fields and caps depth/size so one runaway object
 * cannot produce a multi-megabyte log line.
 */
export function redact(input: LogValue, depth = 0): LogValue {
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    return SENSITIVE_VALUE_PATTERN.test(input) ? REDACTED : truncate(input);
  }

  if (typeof input === "number") {
    return Number.isFinite(input) ? input : String(input);
  }

  if (typeof input === "boolean") return input;

  if (depth >= MAX_DEPTH) return "[max depth]";

  if (Array.isArray(input)) {
    const head = input.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
    return input.length > MAX_ARRAY_ITEMS
      ? [...head, `[+${input.length - MAX_ARRAY_ITEMS} more]`]
      : head;
  }

  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(value, depth + 1);
  }
  return out;
}

/** Errors are not JSON-serialisable by default — unwrap them explicitly. */
export function serialiseError(error: unknown): LogContext {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      // Stacks stay out of production output: they are noisy and can echo
      // interpolated values back into the log.
      stack: readEnv("VORTEX_ENV") === "production" ? undefined : error.stack,
      cause: cause === undefined ? undefined : String(cause),
    };
  }
  return { name: "NonError", message: String(error) };
}

function readEnv(key: string): string | undefined {
  // `process` is absent in some edge/browser bundles; guard rather than assume.
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env[key];
}

function resolveLevel(): LogLevel {
  const raw = readEnv("LOG_LEVEL")?.toLowerCase();
  return LOG_LEVELS.find((level) => level === raw) ?? "info";
}

export interface LoggerOptions {
  /** Minimum level emitted. Defaults to `LOG_LEVEL`, else `info`. */
  level?: LogLevel;
  /** Fields merged into every record this logger writes. */
  bindings?: LogContext;
  /** Sink for finished lines. Swapped in tests. */
  sink?: (line: string, level: LogLevel) => void;
  /** Human-readable output instead of JSON. Defaults to `LOG_PRETTY`. */
  pretty?: boolean;
}

const PRETTY_COLOR: Record<LogLevel, string> = {
  debug: "\\u001b[2;37m",
  info: "\\u001b[36m",
  warn: "\\u001b[33m",
  error: "\\u001b[31m",
};

/*
 * The one place in the codebase allowed to write to stdout. The `no-console`
 * rule exists to stop ad-hoc logging elsewhere, which is precisely what routing
 * everything through this sink enforces.
 */
function defaultSink(line: string, level: LogLevel): void {
  // stderr for warn/error keeps operational noise out of piped stdout.
  if (level === "error" || level === "warn") {
    console.error(line);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(line);
}

export class Logger {
  private readonly minWeight: number;
  private readonly bindings: LogContext;
  private readonly sink: (line: string, level: LogLevel) => void;
  private readonly pretty: boolean;
  readonly level: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? resolveLevel();
    this.minWeight = LEVEL_WEIGHT[this.level];
    this.bindings = options.bindings ?? {};
    this.sink = options.sink ?? defaultSink;
    this.pretty = options.pretty ?? readEnv("LOG_PRETTY") === "1";
  }

  /** Returns a logger that stamps `bindings` onto every record — e.g. a request id. */
  child(bindings: LogContext): Logger {
    return new Logger({
      level: this.level,
      bindings: { ...this.bindings, ...bindings },
      sink: this.sink,
      pretty: this.pretty,
    });
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_WEIGHT[level] >= this.minWeight;
  }

  /** Builds the finished record without writing it. Exposed for tests. */
  format(level: LogLevel, msg: string, context: LogContext = {}): LogRecord {
    const merged = redact({ ...this.bindings, ...context }) as LogContext;
    return {
      ts: new Date().toISOString(),
      level,
      msg,
      service: readEnv("VORTEX_SERVICE_NAME") ?? "vortex-ops",
      env: readEnv("VORTEX_ENV") ?? "development",
      region: readEnv("VORTEX_REGION") ?? "eu-central-1",
      ...merged,
    };
  }

  private write(level: LogLevel, msg: string, context?: LogContext): void {
    if (!this.isEnabled(level)) return;
    const record = this.format(level, msg, context);

    if (this.pretty) {
      const { ts, level: _l, msg: _m, service: _s, env: _e, ...rest } = record;
      const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
      this.sink(
        `${PRETTY_COLOR[level]}${level.toUpperCase().padEnd(5)}\\u001b[0m ${ts} ${msg}${extras}`,
        level,
      );
      return;
    }

    this.sink(JSON.stringify(record), level);
  }

  debug(msg: string, context?: LogContext): void {
    this.write("debug", msg, context);
  }

  info(msg: string, context?: LogContext): void {
    this.write("info", msg, context);
  }

  warn(msg: string, context?: LogContext): void {
    this.write("warn", msg, context);
  }

  error(msg: string, context?: LogContext): void {
    this.write("error", msg, context);
  }

  /** Convenience for the `catch` block: unwraps the error into structured fields. */
  exception(msg: string, error: unknown, context: LogContext = {}): void {
    this.write("error", msg, { ...context, error: serialiseError(error) });
  }

  /**
   * Times an async operation and logs one record with its outcome. Errors are
   * logged and rethrown — this measures, it never swallows.
   */
  async time<T>(msg: string, fn: () => Promise<T>, context: LogContext = {}): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await fn();
      this.info(msg, { ...context, outcome: "ok", durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      this.exception(msg, error, {
        ...context,
        outcome: "error",
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}

/**
 * Captures every emitted line into the in-process ring buffer that powers the
 * live log viewer, in addition to writing it out normally.
 *
 * `log-buffer` only imports `LogLevel` back from here, and as a `import type`
 * that is erased at compile time — so despite the two-way reference on paper,
 * there is no runtime import cycle.
 */
function captureAndWrite(line: string, level: LogLevel): void {
  defaultSink(line, level);
  pushLogEntry(line, level);
}

export const logger = new Logger({ sink: captureAndWrite });

/**
 * Correlation id for one request. Reuses an inbound `x-request-id` when the
 * caller supplied one so a trace survives across service hops.
 */
export function requestId(headers: Headers): string {
  const inbound = headers.get("x-request-id");
  if (inbound && /^[\w.:-]{8,128}$/.test(inbound)) return inbound;
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req_${Math.random().toString(36).slice(2, 12)}`;
}

/** Per-request child logger, pre-bound with the fields every route should carry. */
export function requestLogger(request: Request, route: string): Logger {
  return logger.child({
    requestId: requestId(request.headers),
    route,
    method: request.method,
  });
}
