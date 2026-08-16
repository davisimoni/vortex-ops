/**
 * Display formatting.
 *
 * Every function here is pure and locale-pinned to `en-US`: a dashboard where a
 * number renders differently on the server than in the browser produces a
 * hydration mismatch, and "1.234" meaning two different things across a team is
 * worse than a fixed convention.
 */

const LOCALE = "en-US";

const compactFormatter = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** 1,284 → "1,284" · 12_900 → "12.9K" · 4_200_000 → "4.2M" */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) < 10_000 ? integerFormatter.format(value) : compactFormatter.format(value);
}

export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Sub-second latencies stay in ms; past 1s they read better as seconds. */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${formatNumber(ms / 1000, 2)} s`;
  return `${formatNumber(ms, ms < 10 ? 1 : 0)} ms`;
}

export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${formatNumber(value, decimals)}%`;
}

export function formatRps(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${formatCompact(value)}/s`;
}

/** "2h 14m" — duration as an operator reads it, never as raw milliseconds. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** "14 min ago" / "in 3 h". Client-side only — it depends on the current clock. */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const deltaMs = timestamp - now;
  const abs = Math.abs(deltaMs);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "narrow" });

  if (abs < 60_000) return rtf.format(Math.round(deltaMs / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(deltaMs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(deltaMs / 3_600_000), "hour");
  return rtf.format(Math.round(deltaMs / 86_400_000), "day");
}

export function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function formatDay(timestamp: number): string {
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" }).format(timestamp);
}

export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

/** Initials for an avatar chip: "Ada Lovelace" → "AL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
