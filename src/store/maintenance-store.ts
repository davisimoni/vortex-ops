"use client";

import { create } from "zustand";

import { apiFetch, apiPatch, apiPost, type ApiFailure } from "@/lib/api-client";
import type { MaintenanceWindow } from "@/types";

/**
 * Maintenance window state, backed by the API — the same "store holds a
 * cache, the database holds the truth" shape as `incident-store.ts`.
 */

export interface MutationResult {
  readonly ok: boolean;
  readonly message?: string;
}

const OK: MutationResult = { ok: true };

export interface MaintenanceWindowInput {
  readonly title: string;
  readonly description: string;
  readonly serviceIds: readonly string[];
  readonly startsAt: number;
  readonly endsAt: number;
}

function fail(failure: ApiFailure): MutationResult {
  return { ok: false, message: failure.message };
}

interface MaintenanceState {
  readonly windows: readonly MaintenanceWindow[];
  readonly ready: boolean;
  readonly loadError: string | null;

  load: () => Promise<void>;
  schedule: (input: MaintenanceWindowInput) => Promise<MutationResult & { window?: MaintenanceWindow }>;
  cancel: (windowId: string) => Promise<MutationResult>;
}

function replace(windows: readonly MaintenanceWindow[], updated: MaintenanceWindow): MaintenanceWindow[] {
  return windows.map((window) => (window.id === updated.id ? updated : window));
}

export const useMaintenanceStore = create<MaintenanceState>()((set) => ({
  windows: [],
  ready: false,
  loadError: null,

  load: async () => {
    const result = await apiFetch<{ windows: MaintenanceWindow[] }>("/api/maintenance");

    if (!result.ok) {
      set({ ready: true, loadError: result.failure.message, windows: [] });
      return;
    }

    set({ windows: result.data.windows, ready: true, loadError: null });
  },

  schedule: async (input) => {
    const result = await apiPost<{ window: MaintenanceWindow }>("/api/maintenance", input);
    if (!result.ok) return fail(result.failure);

    set((state) => ({ windows: [...state.windows, result.data.window] }));
    return { ok: true, window: result.data.window };
  },

  cancel: async (windowId) => {
    const result = await apiPatch<{ window: MaintenanceWindow }>(`/api/maintenance/${windowId}`, {
      action: "cancel",
    });
    if (!result.ok) return fail(result.failure);

    set((state) => ({ windows: replace(state.windows, result.data.window) }));
    return OK;
  },
}));
