"use client";

import { create } from "zustand";

import { alertSummary, alertTitle, DEFAULT_RULES, evaluateRules } from "@/lib/alerting";
import { apiFetch, apiPatch, apiPost, type ApiFailure } from "@/lib/api-client";
import { EMPTY_FILTERS } from "@/lib/incidents";
import type {
  AlertRule,
  Incident,
  IncidentFilters,
  IncidentSeverity,
  IncidentStatus,
  MetricPoint,
} from "@/types";

/**
 * Incident state, backed by the API.
 *
 * The store no longer *owns* incidents — the database does. Every mutation is a
 * request, and the response replaces the local copy. There is deliberately no
 * optimistic update on status transitions: the server enforces the state
 * machine, and showing "Resolved" for 200ms before the server rejects the jump
 * would teach the operator that the move worked.
 *
 * Assignment and notes are safe to apply optimistically, but they are not,
 * for one reason: the timeline entry is written server-side with the server's
 * clock and the actor's canonical name. Rendering a locally-invented entry that
 * is then replaced is churn for no perceptible gain on a sub-100ms call.
 */

export interface MutationResult {
  readonly ok: boolean;
  readonly message?: string;
}

const OK: MutationResult = { ok: true };

export interface DeclareIncidentInput {
  readonly title: string;
  readonly summary: string;
  readonly serviceId: string;
  readonly severity: IncidentSeverity;
}

function fail(failure: ApiFailure): MutationResult {
  return { ok: false, message: failure.message };
}

interface IncidentState {
  readonly incidents: readonly Incident[];
  readonly filters: IncidentFilters;
  readonly selectedId: string | null;
  readonly rules: readonly AlertRule[];
  readonly ready: boolean;
  readonly loadError: string | null;
  /** Rule ids with an open incident, so one breach does not open ten copies. */
  readonly firingRuleIds: readonly string[];

  load: () => Promise<void>;
  setFilters: (patch: Partial<IncidentFilters>) => void;
  resetFilters: () => void;
  select: (id: string | null) => void;

  assign: (incidentId: string, memberId: string | null) => Promise<MutationResult>;
  transition: (incidentId: string, next: IncidentStatus) => Promise<MutationResult>;
  comment: (incidentId: string, message: string) => Promise<MutationResult>;
  /** A human declaring an incident by hand, as opposed to a rule opening one. */
  declare: (input: DeclareIncidentInput) => Promise<MutationResult & { incident?: Incident }>;

  /** Runs the rule engine and persists any incident it opens. */
  ingestWindow: (points: readonly MetricPoint[]) => Promise<readonly Incident[]>;

  /** Fires the chaos drill: opens a real incident and notifies integrations server-side. */
  triggerChaos: () => Promise<MutationResult & { incident?: Incident; spikeDurationMs?: number }>;
}

function replace(incidents: readonly Incident[], updated: Incident): Incident[] {
  return incidents.map((incident) => (incident.id === updated.id ? updated : incident));
}

function firingRulesFrom(incidents: readonly Incident[]): string[] {
  return incidents
    .filter((incident) => incident.status !== "resolved" && incident.ruleId !== null)
    .map((incident) => incident.ruleId as string);
}

export const useIncidentStore = create<IncidentState>()((set, get) => ({
  incidents: [],
  filters: EMPTY_FILTERS,
  selectedId: null,
  rules: DEFAULT_RULES,
  ready: false,
  loadError: null,
  firingRuleIds: [],

  load: async () => {
    const result = await apiFetch<{ incidents: Incident[] }>("/api/incidents");

    if (!result.ok) {
      set({ ready: true, loadError: result.failure.message, incidents: [] });
      return;
    }

    set({
      incidents: result.data.incidents,
      firingRuleIds: firingRulesFrom(result.data.incidents),
      ready: true,
      loadError: null,
    });
  },

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  select: (id) => set({ selectedId: id }),

  assign: async (incidentId, memberId) => {
    const result = await apiPatch<{ incident: Incident }>(`/api/incidents/${incidentId}`, {
      action: "assign",
      assigneeId: memberId,
    });
    if (!result.ok) return fail(result.failure);

    set((state) => ({ incidents: replace(state.incidents, result.data.incident) }));
    return OK;
  },

  transition: async (incidentId, next) => {
    const result = await apiPatch<{ incident: Incident }>(`/api/incidents/${incidentId}`, {
      action: "transition",
      status: next,
    });
    if (!result.ok) return fail(result.failure);

    const updated = result.data.incident;
    set((state) => ({
      incidents: replace(state.incidents, updated),
      // A resolved incident re-arms its rule; leaving it in the firing list
      // would silence that alert for the rest of the session.
      firingRuleIds:
        updated.status === "resolved" && updated.ruleId
          ? state.firingRuleIds.filter((ruleId) => ruleId !== updated.ruleId)
          : state.firingRuleIds,
    }));
    return OK;
  },

  comment: async (incidentId, message) => {
    const trimmed = message.trim();
    if (trimmed.length === 0) return { ok: false, message: "Write something first." };

    const result = await apiPatch<{ incident: Incident }>(`/api/incidents/${incidentId}`, {
      action: "comment",
      message: trimmed,
    });
    if (!result.ok) return fail(result.failure);

    set((state) => ({ incidents: replace(state.incidents, result.data.incident) }));
    return OK;
  },

  declare: async (input) => {
    const title = input.title.trim();
    const summary = input.summary.trim();
    if (title.length < 4) return { ok: false, message: "Give the incident a descriptive title." };
    if (summary.length < 4) return { ok: false, message: "Add a short summary of what's happening." };

    const result = await apiPost<{ incident: Incident }>("/api/incidents", {
      title,
      summary,
      serviceId: input.serviceId,
      severity: input.severity,
    });
    if (!result.ok) return fail(result.failure);

    set((state) => ({ incidents: [result.data.incident, ...state.incidents] }));
    return { ok: true, incident: result.data.incident };
  },

  ingestWindow: async (points) => {
    const { rules, firingRuleIds, ready } = get();
    if (!ready || points.length === 0) return [];

    const breaching = evaluateRules(points, rules).filter(
      (evaluation) => evaluation.breached && !firingRuleIds.includes(evaluation.rule.id),
    );
    if (breaching.length === 0) return [];

    // Claim the rules before awaiting. Samples arrive every two seconds and the
    // POST is not instant; without this, two ticks both see the rule as unfired
    // and open duplicate incidents.
    set((state) => ({
      firingRuleIds: [...state.firingRuleIds, ...breaching.map((entry) => entry.rule.id)],
    }));

    const opened: Incident[] = [];

    for (const evaluation of breaching) {
      const result = await apiPost<{ incident: Incident }>("/api/incidents", {
        title: alertTitle(evaluation),
        summary: alertSummary(evaluation),
        serviceId: evaluation.rule.serviceId,
        severity: evaluation.rule.severity,
        ruleId: evaluation.rule.id,
      });

      if (!result.ok) {
        // Release the claim so the next breach can retry — a permanently
        // claimed rule is a permanently silenced alert. Except on 403: the
        // role simply cannot declare incidents, and retrying every two seconds
        // would be a self-inflicted denial of service against our own API.
        if (result.failure.status !== 403) {
          set((state) => ({
            firingRuleIds: state.firingRuleIds.filter((id) => id !== evaluation.rule.id),
          }));
        }
        continue;
      }

      opened.push(result.data.incident);
    }

    if (opened.length === 0) return [];

    set((state) => ({ incidents: [...opened, ...state.incidents] }));
    return opened;
  },

  triggerChaos: async () => {
    const result = await apiPost<{ incident: Incident; spikeDurationMs: number }>(
      "/api/chaos/simulate",
      {},
    );
    if (!result.ok) return fail(result.failure);

    set((state) => ({ incidents: [result.data.incident, ...state.incidents] }));
    return { ok: true, incident: result.data.incident, spikeDurationMs: result.data.spikeDurationMs };
  },
}));
