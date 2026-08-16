"use client";

import { AlertCircle, CheckCircle2, KeyRound, Send, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/system/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/field";
import { formatRelative } from "@/lib/format";
import { SEVERITY_LABEL } from "@/lib/incidents";
import { EVENT_LABEL, PROVIDERS } from "@/lib/webhooks/providers";
import { useIntegrationStore } from "@/store/integration-store";
import { useToastStore } from "@/store/toast-store";
import type { DeliveryResult, Integration } from "@/types";

function DeliveryRow({ delivery, now }: { readonly delivery: DeliveryResult | null; readonly now: number }) {
  if (delivery === null) {
    return <p className="text-xs text-muted">No delivery attempted yet.</p>;
  }

  const Icon = delivery.ok ? CheckCircle2 : AlertCircle;

  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed">
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-3.5 shrink-0 ${delivery.ok ? "text-good" : "text-crit"}`}
      />
      <span className="min-w-0 text-ink2">
        <span className="font-medium text-ink">
          {delivery.ok ? "Delivered" : "Failed"}
          {delivery.status === null ? "" : ` · ${delivery.status}`}
        </span>{" "}
        {delivery.detail}{" "}
        <span className="text-muted">({formatRelative(delivery.at, now)})</span>
      </span>
    </p>
  );
}

export interface IntegrationCardProps {
  readonly integration: Integration;
  readonly now: number;
  readonly onEdit: (integration: Integration) => void;
}

/**
 * One configured integration.
 *
 * "Send test payload" now fires `POST /api/integrations/trigger` — a **real**
 * request to the saved destination, with the credential decrypted server-side.
 * Nothing resembling a token ever reaches this component: the card only shows
 * `integration.credentialHint` (`••••4f2a`), which confirms *a* credential is
 * configured without being useful to anyone who reads it off the screen.
 */
export function IntegrationCard({ integration, now, onEdit }: IntegrationCardProps) {
  const definition = PROVIDERS[integration.provider];
  const toggle = useIntegrationStore((state) => state.toggle);
  const remove = useIntegrationStore((state) => state.remove);
  const trigger = useIntegrationStore((state) => state.trigger);
  const sendingId = useIntegrationStore((state) => state.sendingId);
  const pushToast = useToastStore((state) => state.push);

  const mayManage = usePermission("integration:manage");
  const mayTest = usePermission("integration:test");

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const testing = sendingId === integration.id;

  const handleTest = async (): Promise<void> => {
    const outcome = await trigger(integration.id);

    if (outcome.result) {
      pushToast({
        tone: outcome.result.ok ? "success" : "warning",
        title: outcome.result.ok ? "Notification delivered" : "Notification not delivered",
        body: outcome.result.detail,
      });
      return;
    }

    pushToast({
      tone: "warning",
      title: "Could not send",
      ...(outcome.message ? { body: outcome.message } : {}),
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{integration.name}</h3>
            <Badge tone="neutral">{definition.label}</Badge>
            {definition.verified ? (
              <Badge tone="good" icon={ShieldCheck}>
                Verified contract
              </Badge>
            ) : (
              <Badge tone="warning" icon={TriangleAlert}>
                Unverified payload shape
              </Badge>
            )}
          </div>
          {!definition.derivesUrl ? (
            <p className="mt-1 break-all font-mono text-[11px] text-muted">{integration.targetUrl}</p>
          ) : null}
          {integration.credentialHint ? (
            <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-muted">
              <KeyRound aria-hidden="true" className="size-3" />
              {integration.credentialHint}
            </p>
          ) : null}
        </div>

        <Switch
          checked={integration.enabled}
          disabled={!mayManage}
          onChange={() => void toggle(integration.id)}
          label={`${integration.enabled ? "Disable" : "Enable"} ${integration.name}`}
          hideLabel
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {integration.events.map((event) => (
          <span
            key={event}
            className="rounded-md border border-hairline bg-raised px-2 py-0.5 text-[11px] text-ink2"
          >
            {EVENT_LABEL[event]}
          </span>
        ))}
        <span className="rounded-md border border-hairline px-2 py-0.5 text-[11px] text-muted">
          {SEVERITY_LABEL[integration.minSeverity]} and above
        </span>
      </div>

      <DeliveryRow delivery={integration.lastDelivery} now={now} />

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <Button
          size="sm"
          variant="primary"
          loading={testing}
          disabled={!mayTest}
          title={
            mayTest
              ? "Sends a real, clearly-marked test notification to this destination"
              : "Your role cannot send notifications."
          }
          onClick={() => {
            void handleTest();
          }}
        >
          <Send aria-hidden="true" className="size-3.5" />
          Send test payload
        </Button>

        <Button size="sm" variant="secondary" disabled={!mayManage} onClick={() => onEdit(integration)}>
          Edit
        </Button>

        {confirmingDelete ? (
          <>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                void remove(integration.id).then((result) => {
                  if (!result.ok) {
                    pushToast({
                      tone: "warning",
                      title: "Not removed",
                      ...(result.message ? { body: result.message } : {}),
                    });
                    setConfirmingDelete(false);
                    return;
                  }
                  pushToast({ tone: "info", title: `Removed ${integration.name}` });
                });
              }}
            >
              Confirm removal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={!mayManage}
            className="ml-auto"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}
