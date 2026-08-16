"use client";

import { Skull } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/system/session-provider";
import { Button } from "@/components/ui/button";
import { useIncidentStore } from "@/store/incident-store";
import { useMetricsStore } from "@/store/metrics-store";
import { useToastStore } from "@/store/toast-store";

/**
 * A discreet "break something on purpose" button.
 *
 * Opens a real CRITICAL incident, fires real notifications to every
 * subscribed integration, and drives a decaying spike through the live
 * charts — a one-click gameday exercise, not a cosmetic animation. Gated
 * behind `chaos:trigger` (the same operational tier as the log viewer: people
 * who carry the pager) and a two-step confirm, since a stray click here
 * pages whatever integrations are configured.
 */
export function ChaosButton() {
  const allowed = usePermission("chaos:trigger");
  const triggerChaos = useIncidentStore((state) => state.triggerChaos);
  const triggerSpike = useMetricsStore((state) => state.triggerChaosSpike);
  const pushToast = useToastStore((state) => state.push);

  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  if (!allowed) return null;

  const run = async (): Promise<void> => {
    setRunning(true);
    const result = await triggerChaos();
    setRunning(false);
    setConfirming(false);

    if (!result.ok || !result.incident) {
      pushToast({
        tone: "warning",
        title: "Drill did not start",
        ...(result.message ? { body: result.message } : {}),
      });
      return;
    }

    triggerSpike(result.spikeDurationMs);
    pushToast({
      tone: "critical",
      title: "Chaos drill started",
      body: `${result.incident.title} — notifications sent to every subscribed integration.`,
    });
  };

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Opens a real incident and notifies your integrations.</span>
        <Button size="sm" variant="danger" loading={running} onClick={() => void run()}>
          Confirm drill
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={running}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      title="Simulate an infrastructure failure: opens a critical incident and notifies your integrations"
      onClick={() => setConfirming(true)}
      className="text-muted hover:text-crit"
    >
      <Skull aria-hidden="true" className="size-3.5" />
      Simulate infrastructure failure
    </Button>
  );
}
