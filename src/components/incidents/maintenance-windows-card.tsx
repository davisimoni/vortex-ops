"use client";

import { CalendarClock, CalendarOff, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { usePermission } from "@/components/system/session-provider";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatTimestamp } from "@/lib/format";
import { deriveMaintenanceStatus, MAINTENANCE_STATUS_LABEL, maintenanceServiceNames } from "@/lib/maintenance";
import { SERVICES } from "@/lib/services";
import { useMaintenanceStore } from "@/store/maintenance-store";
import { useToastStore } from "@/store/toast-store";
import type { MaintenanceStatus } from "@/types";

const STATUS_TONE: Record<MaintenanceStatus, BadgeTone> = {
  scheduled: "brand",
  in_progress: "warning",
  completed: "neutral",
  cancelled: "neutral",
};

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in the *browser's* local time, not UTC. */
function toLocalInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(): string {
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60_000);
  in3Days.setMinutes(0, 0, 0);
  return toLocalInputValue(in3Days);
}

function defaultEnd(): string {
  const in3DaysPlus1h = new Date(Date.now() + 3 * 24 * 60 * 60_000 + 60 * 60_000);
  in3DaysPlus1h.setMinutes(0, 0, 0);
  return toLocalInputValue(in3DaysPlus1h);
}

function ScheduleForm({ onDone }: { readonly onDone: () => void }) {
  const schedule = useMaintenanceStore((state) => state.schedule);
  const pushToast = useToastStore((state) => state.push);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [serviceIds, setServiceIds] = useState<readonly string[]>([]);
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const toggleService = (id: string): void => {
    setServiceIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const submit = async (): Promise<void> => {
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();

    if (serviceIds.length === 0) {
      setError("Pick at least one affected service.");
      return;
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      setError("Start and end need a valid date and time.");
      return;
    }
    if (endMs <= startMs) {
      setError("End must be after start.");
      return;
    }

    setSubmitting(true);
    const result = await schedule({ title, description, serviceIds, startsAt: startMs, endsAt: endMs });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? "Could not schedule the maintenance window.");
      return;
    }

    pushToast({ tone: "info", title: "Maintenance scheduled", body: title.trim() });
    onDone();
  };

  return (
    <Card>
      <CardHeader
        title="Schedule maintenance"
        subtitle="Synced automatically onto the public status page — nothing extra to publish."
        actions={
          <Button size="sm" variant="ghost" onClick={onDone}>
            <X aria-hidden="true" className="size-3.5" />
            Cancel
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <Field label="Title" required error={error}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError(undefined);
              }}
              placeholder="Postgres primary — replica failover rehearsal"
            />
          )}
        </Field>

        <Field label="Description" description="Shown on the public status page, in plain language customers will read.">
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What's happening, and should customers expect any disruption?"
            />
          )}
        </Field>

        <div>
          <span className="text-xs font-medium text-ink2">Affected services</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SERVICES.map((service) => {
              const selected = serviceIds.includes(service.id);
              return (
                <button
                  key={service.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleService(service.id)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    selected
                      ? "border-brand bg-brand/10 text-ink"
                      : "border-hairline text-ink2 hover:border-hairline-strong"
                  }`}
                >
                  {service.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            )}
          </Field>
          <Field label="Ends">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" loading={submitting} onClick={() => void submit()}>
            <Plus aria-hidden="true" className="size-3.5" />
            Schedule maintenance
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function MaintenanceWindowsCard() {
  const windows = useMaintenanceStore((state) => state.windows);
  const ready = useMaintenanceStore((state) => state.ready);
  const load = useMaintenanceStore((state) => state.load);
  const cancelWindow = useMaintenanceStore((state) => state.cancel);
  const pushToast = useToastStore((state) => state.push);
  const mayManage = usePermission("maintenance:manage");

  const [scheduling, setScheduling] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = async (windowId: string): Promise<void> => {
    setCancellingId(windowId);
    const result = await cancelWindow(windowId);
    setCancellingId(null);
    if (!result.ok) {
      pushToast({ tone: "warning", title: "Could not cancel", ...(result.message ? { body: result.message } : {}) });
    }
  };

  const visible = [...windows].sort((a, b) => a.startsAt - b.startsAt);

  return (
    <>
      {scheduling ? <ScheduleForm onDone={() => setScheduling(false)} /> : null}

      <Card>
        <CardHeader
          title="Maintenance windows"
          subtitle="Scheduled maintenance is synced automatically onto the public status page."
          actions={
            !scheduling && mayManage ? (
              <Button size="sm" variant="primary" onClick={() => setScheduling(true)}>
                <Plus aria-hidden="true" className="size-3.5" />
                Schedule maintenance
              </Button>
            ) : null
          }
        />
        <CardBody>
          {!ready ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={CalendarOff}
              title="No maintenance windows"
              body="Nothing scheduled. A window created here appears immediately on the public status page."
              action={
                mayManage && !scheduling ? (
                  <Button size="sm" variant="primary" onClick={() => setScheduling(true)}>
                    <Plus aria-hidden="true" className="size-3.5" />
                    Schedule maintenance
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-hairline">
              {visible.map((window) => {
                const status = deriveMaintenanceStatus(window);
                const cancellable = mayManage && (status === "scheduled" || status === "in_progress");
                return (
                  <li key={window.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-ink">{window.title}</p>
                        <Badge tone={STATUS_TONE[status]}>{MAINTENANCE_STATUS_LABEL[status]}</Badge>
                      </div>
                      {window.description ? (
                        <p className="mt-1 text-xs leading-relaxed text-ink2">{window.description}</p>
                      ) : null}
                      <p className="tabular mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        <CalendarClock aria-hidden="true" className="size-3" />
                        {formatTimestamp(window.startsAt)} → {formatTimestamp(window.endsAt)}
                        <span aria-hidden="true">·</span>
                        {maintenanceServiceNames(window).join(", ")}
                      </p>
                    </div>
                    {cancellable ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={cancellingId === window.id}
                        onClick={() => void handleCancel(window.id)}
                        className="text-muted hover:text-crit"
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
