"use client";

import { ArrowDownToLine, Download, Pause, Play, Radio, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useLogStream } from "@/lib/hooks/use-log-stream";
import { exportLogText, filterLogEntries, parseLogLine } from "@/lib/log-format";
import { cn } from "@/lib/utils";
import type { StreamStatus } from "@/types";

const LEVEL_OPTIONS = ["info", "warn", "error"] as const;
type LevelOption = (typeof LEVEL_OPTIONS)[number];

const LEVEL_COLOR: Record<LevelOption, string> = {
  info: "text-[#8fa3b8]",
  warn: "text-warn",
  error: "text-crit",
};

const LEVEL_CHIP_ON: Record<LevelOption, string> = {
  info: "border-[#8fa3b8] bg-[#8fa3b8]/15",
  warn: "border-warn bg-warn/15",
  error: "border-crit bg-crit/15",
};

const STREAM_COPY: Record<StreamStatus, { label: string; className: string }> = {
  connecting: { label: "Connecting", className: "text-[#8fa3b8]" },
  live: { label: "Live", className: "text-good" },
  reconnecting: { label: "Reconnecting", className: "text-warn" },
  offline: { label: "Disconnected", className: "text-crit" },
  paused: { label: "Paused", className: "text-[#8fa3b8]" },
};

/** How close to the bottom (px) counts as "still following the tail". */
const STICK_THRESHOLD_PX = 48;

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Dark, CLI-styled live tail of the structured logger's output.
 *
 * Deliberately does not follow the app's light/dark toggle — the status
 * colours it uses (`--status-*`) are fixed across both themes anyway (see
 * `globals.css`), and a terminal panel that stayed dark regardless of theme
 * reads as an intentional "this is a console" cue rather than a styling bug.
 */
export function LogViewer() {
  const [paused, setPaused] = useState(false);
  const [levels, setLevels] = useState<ReadonlySet<LevelOption>>(new Set(LEVEL_OPTIONS));
  const [query, setQuery] = useState("");
  const [stickToBottom, setStickToBottom] = useState(true);

  const { entries, status, clear } = useLogStream(paused);
  const effectiveStatus: StreamStatus = paused ? "paused" : status;
  const streamCopy = STREAM_COPY[effectiveStatus];

  const filtered = useMemo(() => filterLogEntries(entries, levels, query), [entries, levels, query]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stickToBottom) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [filtered, stickToBottom]);

  const handleScroll = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setStickToBottom(distanceFromBottom <= STICK_THRESHOLD_PX);
  };

  const jumpToBottom = (): void => {
    setStickToBottom(true);
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  };

  const toggleLevel = (level: LevelOption): void => {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) {
        // Never allow every level to be switched off — an empty terminal
        // with no visible cause reads as broken, not as "filtered to nothing".
        if (next.size === 1) return next;
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const handleExport = (): void => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`vortex-ops-logs_${stamp}.log`, exportLogText(filtered));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface p-3">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Filter by log level</legend>
          {LEVEL_OPTIONS.map((level) => {
            const on = levels.has(level);
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLevel(level)}
                className={cn(
                  "rounded-md border border-hairline px-2.5 py-1 font-mono text-xs font-medium uppercase tracking-wide transition-colors",
                  "hover:border-hairline-strong",
                  on ? cn(LEVEL_CHIP_ON[level], LEVEL_COLOR[level]) : "text-muted",
                )}
              >
                {level}
              </button>
            );
          })}
        </fieldset>

        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs"
            aria-label="Search logs"
            className="h-8 w-full rounded-lg border border-hairline bg-plane pl-9 pr-3 text-sm text-ink placeholder:text-muted hover:border-hairline-strong"
          />
        </div>

        <span
          className={cn("inline-flex items-center gap-1.5 text-xs font-medium", streamCopy.className)}
        >
          <Radio
            aria-hidden="true"
            className={cn("size-3", effectiveStatus === "live" && "animate-pulse-dot")}
          />
          {streamCopy.label}
        </span>

        <span className="text-xs text-muted">
          {filtered.length} of {entries.length} lines
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={paused}
            onClick={() => setPaused((current) => !current)}
          >
            {paused ? (
              <>
                <Play aria-hidden="true" className="size-3.5" />
                Resume stream
              </>
            ) : (
              <>
                <Pause aria-hidden="true" className="size-3.5" />
                Pause stream
              </>
            )}
          </Button>

          <Button size="sm" variant="secondary" onClick={handleExport} disabled={filtered.length === 0}>
            <Download aria-hidden="true" className="size-3.5" />
            Export logs
          </Button>

          <Button size="sm" variant="ghost" onClick={clear} title="Clear the on-screen buffer">
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          role="log"
          aria-label="Live application logs"
          aria-live="off"
          className="h-[60vh] min-h-80 overflow-y-auto rounded-xl border border-hairline bg-[#0a0c10] p-3 font-mono text-[12.5px] leading-relaxed text-[#c9d1d9] shadow-inner"
        >
          {filtered.length === 0 ? (
            <p className="p-2 text-[#5c6773]">
              {entries.length === 0 ? "Waiting for log lines…" : "No lines match the current filters."}
            </p>
          ) : (
            filtered.map((entry) => {
              const parsed = parseLogLine(entry.line);
              const levelKey = (parsed.level ?? entry.level) as LevelOption;
              const color = LEVEL_COLOR[levelKey] ?? "text-[#c9d1d9]";

              return (
                <div key={entry.id} className="flex gap-2 whitespace-pre-wrap break-all py-0.5">
                  <span className="shrink-0 text-[#5c6773]">
                    {(parsed.ts ?? entry.capturedAt).slice(11, 19)}
                  </span>
                  <span className={cn("shrink-0 w-12 uppercase", color)}>
                    {(parsed.level ?? entry.level).slice(0, 5)}
                  </span>
                  <span className="min-w-0 flex-1">
                    {parsed.msg}
                    {parsed.fields.length > 0 ? (
                      <span className="text-[#5c6773]">
                        {" "}
                        {parsed.fields.map(([key, value]) => `${key}=${value}`).join(" ")}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {!stickToBottom ? (
          <Button
            size="sm"
            variant="primary"
            onClick={jumpToBottom}
            className="absolute bottom-3 right-3 shadow-[var(--shadow-card)]"
          >
            <ArrowDownToLine aria-hidden="true" className="size-3.5" />
            Jump to latest
          </Button>
        ) : null}
      </div>
    </div>
  );
}
