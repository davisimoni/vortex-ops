"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { INCIDENT_SEVERITIES, SEVERITY_LABEL } from "@/lib/incidents";
import { SERVICES } from "@/lib/services";
import { useIncidentStore } from "@/store/incident-store";
import { useToastStore } from "@/store/toast-store";
import type { IncidentSeverity } from "@/types";

/**
 * Manual incident declaration.
 *
 * Most incidents here open automatically — a threshold rule breaching for its
 * dwell time. This is the other path: something a human noticed first (a
 * customer report, a provider's status page) that never crossed a metric
 * threshold at all. Without it, `incident:create` is a permission nothing in
 * the UI ever exercises.
 */
export function DeclareIncidentForm({ onDone }: { readonly onDone: () => void }) {
  const declare = useIncidentStore((state) => state.declare);
  const select = useIncidentStore((state) => state.select);
  const pushToast = useToastStore((state) => state.push);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [serviceId, setServiceId] = useState(SERVICES[0]?.id ?? "");
  const [severity, setSeverity] = useState<IncidentSeverity>("warning");
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    const result = await declare({ title, summary, serviceId, severity });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? "Could not declare the incident.");
      return;
    }

    pushToast({ tone: "info", title: `Declared ${result.incident?.id}`, body: title.trim() });
    if (result.incident) select(result.incident.id);
    onDone();
  };

  return (
    <Card>
      <CardHeader
        title="Declare an incident"
        subtitle="For something a human noticed first — a customer report, a provider's status page — that never crossed an alert threshold."
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
              placeholder="Payments — checkout confirmation emails delayed"
            />
          )}
        </Field>

        <Field label="Summary" required>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What's happening, and how do you know?"
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service">
            {(fieldProps) => (
              <Select {...fieldProps} value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                {SERVICES.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Severity">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={severity}
                onChange={(event) => setSeverity(event.target.value as IncidentSeverity)}
              >
                {INCIDENT_SEVERITIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {SEVERITY_LABEL[entry]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" loading={submitting} onClick={() => void submit()}>
            <Plus aria-hidden="true" className="size-3.5" />
            Declare incident
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
