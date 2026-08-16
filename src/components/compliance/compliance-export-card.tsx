"use client";

import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { useState } from "react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToastStore } from "@/store/toast-store";

type Dataset = "incidents" | "audit" | "sla";
type Format = "csv" | "json";
type WindowChoice = "all" | "30d" | "90d" | "365d";

const DATASET_OPTIONS: ReadonlyArray<{ value: Dataset; label: string; description: string }> = [
  {
    value: "incidents",
    label: "Incident register",
    description: "Every incident: severity, timing, responder, target attainment.",
  },
  {
    value: "sla",
    label: "SLA summary",
    description: "MTTR, MTTA and target attainment, broken down by service.",
  },
  {
    value: "audit",
    label: "Audit trail",
    description: "Every recorded action in this organisation, including denials.",
  },
];

const WINDOW_OPTIONS: ReadonlyArray<{ value: WindowChoice; label: string; days: number | null }> = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "365d", label: "Last 12 months", days: 365 },
  { value: "all", label: "All time", days: null },
];

const FORMAT_OPTIONS = [
  { value: "csv" as const, label: "CSV" },
  { value: "json" as const, label: "JSON" },
];

/**
 * SOC 2 / compliance export.
 *
 * A plain link, not a fetch-then-blob dance: `/api/compliance/export` already
 * sets `Content-Disposition: attachment`, so a same-origin navigation is the
 * correct way to trigger it — the browser downloads the file and the page
 * never leaves. Building a blob URL client-side would just be a second, worse
 * implementation of what the response header already does.
 */
export function ComplianceExportCard() {
  const [dataset, setDataset] = useState<Dataset>("incidents");
  const [format, setFormat] = useState<Format>("csv");
  const [windowChoice, setWindowChoice] = useState<WindowChoice>("90d");
  const pushToast = useToastStore((state) => state.push);

  const selectedWindow = WINDOW_OPTIONS.find((option) => option.value === windowChoice);

  /*
   * The window is sent as a relative day-count, not a precomputed timestamp:
   * resolving "90 days ago" against `Date.now()` is left to the server. Two
   * reasons — it keeps this component pure (no impure `Date.now()` call
   * during render), and it avoids a window boundary that silently drifts
   * between whatever the browser's clock says and what the server enforces.
   */
  const params = new URLSearchParams({ dataset, format });
  if (selectedWindow?.days) params.set("days", String(selectedWindow.days));
  const href = `/api/compliance/export?${params.toString()}`;

  return (
    <Card>
      <CardHeader
        title="Compliance export"
        subtitle="Immediate JSON or CSV export of the incident register, SLA attainment or the audit trail — for a SOC 2 evidence request or a post-mortem."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {DATASET_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={dataset === option.value}
              onClick={() => setDataset(option.value)}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
                dataset === option.value
                  ? "border-brand bg-brand/8"
                  : "border-hairline hover:border-hairline-strong"
              }`}
            >
              <span className="text-sm font-semibold text-ink">{option.label}</span>
              <span className="text-xs leading-relaxed text-muted">{option.description}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink2">Window</span>
            <Select
              value={windowChoice}
              onChange={(event) => setWindowChoice(event.target.value as WindowChoice)}
              aria-label="Export window"
              className="w-44"
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink2">Format</span>
            <Segmented label="Export format" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
          </div>

          <a
            href={href}
            onClick={() =>
              pushToast({
                tone: "info",
                title: "Export started",
                body: `Downloading the ${dataset} ${format.toUpperCase()} export.`,
                ttlMs: 3_000,
              })
            }
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-brand-contrast transition-opacity hover:opacity-90"
          >
            {format === "csv" ? (
              <FileSpreadsheet aria-hidden="true" className="size-3.5" />
            ) : (
              <FileJson aria-hidden="true" className="size-3.5" />
            )}
            <Download aria-hidden="true" className="size-3.5" />
            Download
          </a>
        </div>

        <p className="text-[11px] leading-relaxed text-muted">
          Exports are themselves audited — who exported what, and when, is recorded on the trail
          below. CSV output neutralises spreadsheet formula injection in operator-supplied text.
        </p>
      </CardBody>
    </Card>
  );
}
