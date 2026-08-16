"use client";

import { useCallback, useEffect, useRef } from "react";

import { useMetricStream } from "@/lib/hooks/use-metric-stream";
import { SEVERITY_LABEL } from "@/lib/incidents";
import { serviceName } from "@/lib/services";
import { useSession } from "@/components/system/session-provider";
import { useIncidentStore } from "@/store/incident-store";
import { useIntegrationStore } from "@/store/integration-store";
import { useMetricsStore } from "@/store/metrics-store";
import { usePreviewStore } from "@/store/session-store";
import { useTeamStore } from "@/store/team-store";
import { useToastStore, type ToastTone } from "@/store/toast-store";
import type { IncidentSeverity } from "@/types";

const SEVERITY_TONE: Record<IncidentSeverity, ToastTone> = {
  critical: "critical",
  major: "warning",
  warning: "info",
};

/**
 * Wires the live pipeline together, once, for the whole app.
 *
 *   sample → metrics store → alert rules → POST /api/incidents → toast
 *
 * It lives in the shell rather than on the dashboard page: an alert that only
 * fires while you happen to be looking at the charts is not an alerting engine.
 * Rendering nothing, it is a behaviour, not a component.
 *
 * Incidents opened here are now *persisted*. Reload the page and the incident
 * the rule opened is still there — which is the whole difference between a
 * simulation and a system.
 */
export function LiveEngine() {
  const session = useSession();
  const organizationId = session.organization.id;

  const initialiseMetrics = useMetricsStore((state) => state.initialise);
  const metricsReady = useMetricsStore((state) => state.ready);
  const loadIncidents = useIncidentStore((state) => state.load);
  const loadTeam = useTeamStore((state) => state.load);
  const loadIntegrations = useIntegrationStore((state) => state.load);
  const restorePreview = usePreviewStore((state) => state.restore);
  const pushToast = useToastStore((state) => state.push);

  /*
   * Keyed on the organisation. Switching tenant re-runs everything: new seed
   * for the telemetry, new fetches for incidents, team and integrations. A
   * switcher that changed the label in the header and left the data behind
   * would be the most dangerous kind of bug in a multi-tenant product.
   */
  useEffect(() => {
    initialiseMetrics(session.organization.metricSeed, Date.now());
    restorePreview();

    void loadIncidents();
    void loadTeam();
    void loadIntegrations();
  }, [
    organizationId,
    session.organization.metricSeed,
    initialiseMetrics,
    restorePreview,
    loadIncidents,
    loadTeam,
    loadIntegrations,
  ]);

  // The rule engine writes to the API, so a slow response must not let the next
  // sample start a second round of the same evaluation.
  const ingesting = useRef(false);

  const handleSample = useCallback(() => {
    if (ingesting.current) return;
    if (!useMetricsStore.getState().ready) return;

    const series = useMetricsStore.getState().series;
    // The rule engine only needs the recent tail; handing it a 30-day window
    // would re-scan thousands of points every two seconds for nothing.
    const window = series.slice(-12);

    ingesting.current = true;
    void useIncidentStore
      .getState()
      .ingestWindow(window)
      .then((opened) => {
        for (const incident of opened) {
          pushToast({
            tone: SEVERITY_TONE[incident.severity],
            title: `${SEVERITY_LABEL[incident.severity]} — ${serviceName(incident.serviceId)}`,
            body: incident.title,
          });
        }
      })
      .finally(() => {
        ingesting.current = false;
      });
  }, [pushToast]);

  useMetricStream(metricsReady ? handleSample : undefined);

  return null;
}
