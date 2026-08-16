import type { LogEntry } from "@/lib/log-schema";

/**
 * Presentation logic for the live log viewer — pure, so the terminal rendering
 * and the filtering can be unit-tested without a browser or an SSE connection.
 */

/** Fields stamped on every record; noise on a live tail, since they never change. */
const REPEATED_FIELDS = new Set(["ts", "level", "msg", "service", "env", "region"]);

export interface ParsedLogLine {
  readonly ts: string | null;
  readonly level: string | null;
  readonly msg: string;
  /** Everything else the record carried, as displayable `key=value` pairs. */
  readonly fields: ReadonlyArray<readonly [string, string]>;
}

function stringifyField(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserialisable]";
    }
  }
  return String(value);
}

/**
 * Parses one emitted line back into its fields.
 *
 * The logger's default sink writes one JSON object per line; `LOG_PRETTY=1`
 * writes a human-readable line instead. Either way this must degrade
 * gracefully — a malformed or pretty-formatted line renders as its raw text
 * with `msg` set to the whole line, rather than throwing and blanking the
 * viewer.
 */
export function parseLogLine(line: string): ParsedLogLine {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not a log record");
    }
    const record = parsed as Record<string, unknown>;

    const fields = Object.entries(record)
      .filter(([key]) => !REPEATED_FIELDS.has(key))
      .map(([key, value]): [string, string] => [key, stringifyField(value)]);

    return {
      ts: typeof record.ts === "string" ? record.ts : null,
      level: typeof record.level === "string" ? record.level : null,
      msg: typeof record.msg === "string" ? record.msg : line,
      fields,
    };
  } catch {
    return { ts: null, level: null, msg: line, fields: [] };
  }
}

/**
 * Level + free-text filter over the captured line, case-insensitive.
 *
 * `levels` takes `ReadonlySet<string>` rather than `ReadonlySet<LogLevel>`:
 * `LogEntry.level` is validated by the wire schema at runtime but typed as
 * `string` statically — the same "runtime-checked, statically loose" pattern
 * the rest of the API layer uses for enum-like fields (see `INCIDENT_SEVERITIES`
 * in `api/incidents/route.ts`).
 */
export function filterLogEntries(
  entries: readonly LogEntry[],
  levels: ReadonlySet<string>,
  query: string,
): LogEntry[] {
  const needle = query.trim().toLowerCase();

  return entries.filter((entry) => {
    if (!levels.has(entry.level)) return false;
    if (needle.length > 0 && !entry.line.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Plain-text export, one line per entry — the file a "tail -f > out.log" would produce. */
export function exportLogText(entries: readonly LogEntry[]): string {
  return entries.map((entry) => entry.line).join("\n");
}
