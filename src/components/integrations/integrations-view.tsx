"use client";

import { PlugZap, Plus, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { IntegrationCard } from "@/components/integrations/integration-card";
import { WebhookBuilder } from "@/components/integrations/webhook-builder";
import { usePermission } from "@/components/system/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntegrationStore } from "@/store/integration-store";
import type { Integration } from "@/types";

type Editing = { readonly mode: "closed" } | { readonly mode: "new" } | { readonly mode: "edit"; readonly integration: Integration };

export function IntegrationsView() {
  const ready = useIntegrationStore((state) => state.ready);
  const loadError = useIntegrationStore((state) => state.loadError);
  const integrations = useIntegrationStore((state) => state.integrations);
  const load = useIntegrationStore((state) => state.load);
  const mayManage = usePermission("integration:manage");

  const [editing, setEditing] = useState<Editing>({ mode: "closed" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardBody className="text-sm text-crit">{loadError}</CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Notification routing"
          subtitle="Where incidents go when a rule fires. Every destination is validated before delivery and again at send time."
          actions={
            editing.mode === "closed" ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!mayManage}
                title={mayManage ? undefined : "Your role cannot create integrations."}
                onClick={() => setEditing({ mode: "new" })}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                New integration
              </Button>
            ) : null
          }
        />
        <CardBody>
          <div className="flex items-start gap-2.5 rounded-lg border border-hairline bg-raised/40 p-3">
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
            <p className="text-xs leading-relaxed text-ink2">
              Test payloads are sent from the server, not the browser, and every destination passes
              an SSRF check first: private, loopback and link-local addresses are refused, redirects
              are not followed, and each request carries an 8-second timeout. The endpoint is rate
              limited to 10 sends per minute — it makes outbound requests to an address you supply,
              which is exactly the shape an attacker would use to scan our network from the inside.
            </p>
          </div>
        </CardBody>
      </Card>

      {editing.mode === "new" ? (
        <WebhookBuilder editing={null} onDone={() => setEditing({ mode: "closed" })} />
      ) : null}

      {editing.mode === "edit" ? (
        <WebhookBuilder
          editing={editing.integration}
          onDone={() => setEditing({ mode: "closed" })}
        />
      ) : null}

      {integrations.length === 0 ? (
        <Card>
          <EmptyState
            icon={PlugZap}
            title="No integrations configured"
            body="Incidents are being tracked, but nothing is being routed anywhere. Add a Slack, PagerDuty or custom webhook destination so a rule that fires at 03:00 reaches a person."
            action={
              mayManage ? (
                <Button size="sm" variant="primary" onClick={() => setEditing({ mode: "new" })}>
                  <Plus aria-hidden="true" className="size-3.5" />
                  New integration
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              now={now}
              onEdit={(target) => setEditing({ mode: "edit", integration: target })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
