"use client";

import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";

import { analyzeIncident } from "@/lib/incident-analysis";
import { useToastStore } from "@/store/toast-store";
import type { Incident } from "@/types";

/**
 * "✨ AI Root Cause Summary" — see `lib/incident-analysis.ts` for what this
 * actually is (a deterministic diagnostic engine, not a live model call) and
 * why that is the honest choice here.
 */
export function RootCauseCard({ incident, now }: { readonly incident: Incident; readonly now: number }) {
  const analysis = analyzeIncident(incident, now);
  const pushToast = useToastStore((state) => state.push);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copy = async (command: string, index: number): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 2_000);
    } catch {
      pushToast({
        tone: "warning",
        title: "Could not copy",
        body: "Your browser blocked clipboard access — select and copy the command manually.",
      });
    }
  };

  return (
    <section className="rounded-xl border border-brand/30 bg-brand/5 p-3.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
        <Sparkles aria-hidden="true" className="size-3.5" />
        AI Root Cause Summary
      </h3>

      <p className="mt-2 text-sm font-semibold text-ink">{analysis.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink2">{analysis.explanation}</p>

      <div className="mt-2 flex items-center gap-1.5">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-brand" style={{ width: `${analysis.confidencePct}%` }} />
        </div>
        <span className="tabular text-[11px] text-muted">{analysis.confidencePct}% confidence</span>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {analysis.commands.map((entry, index) => (
          <div
            key={entry.label}
            className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-surface px-2.5 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-ink2">{entry.label}</p>
              <code className="mt-0.5 block truncate font-mono text-[11px] text-ink" title={entry.command}>
                {entry.command}
              </code>
            </div>
            <button
              type="button"
              onClick={() => void copy(entry.command, index)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hairline bg-raised px-2 py-1 text-[11px] font-medium text-ink2 transition-colors hover:border-hairline-strong hover:text-ink"
            >
              {copiedIndex === index ? (
                <>
                  <Check aria-hidden="true" className="size-3 text-good" />
                  Copied
                </>
              ) : (
                <>
                  <Copy aria-hidden="true" className="size-3" />
                  Copy Fix Command
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-2.5 text-[10px] leading-relaxed text-muted">
        Automated diagnostic, pattern-matched against this service&apos;s dependency profile and current
        telemetry — a starting point for the responder, not a substitute for confirming root cause.
      </p>
    </section>
  );
}
