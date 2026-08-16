"use client";

import { create } from "zustand";

import { apiDelete, apiFetch, apiPatch, apiPost, type ApiFailure } from "@/lib/api-client";
import { checkWebhookUrl } from "@/lib/net/safe-url";
import { PROVIDERS } from "@/lib/webhooks/providers";
import type { MutationResult } from "@/store/incident-store";
import type {
  DeliveryResult,
  IncidentSeverity,
  Integration,
  IntegrationProvider,
  WebhookEvent,
} from "@/types";

export interface IntegrationDraft {
  readonly provider: IntegrationProvider;
  readonly name: string;
  readonly targetUrl: string;
  readonly events: readonly WebhookEvent[];
  readonly minSeverity: IncidentSeverity;
  readonly enabled: boolean;
  /** Present only when the operator typed a new one. Never read back. */
  readonly credential?: { token?: string; destination?: string } | null;
}

interface IntegrationState {
  readonly integrations: readonly Integration[];
  readonly ready: boolean;
  readonly loadError: string | null;
  /** Id currently mid-send, so the button can show progress. */
  readonly sendingId: string | null;

  load: () => Promise<void>;
  create: (draft: IntegrationDraft) => Promise<MutationResult>;
  update: (id: string, patch: Partial<IntegrationDraft>) => Promise<MutationResult>;
  toggle: (id: string) => Promise<MutationResult>;
  remove: (id: string) => Promise<MutationResult>;
  /** Fires a real notification through a stored integration. */
  trigger: (id: string) => Promise<{ ok: boolean; result?: DeliveryResult; message?: string }>;
}

function fail(failure: ApiFailure): MutationResult {
  return { ok: false, message: failure.message };
}

/**
 * Client-side pre-flight on a draft.
 *
 * The server runs the same URL rules again and its answer is the one that
 * counts. This exists so the operator sees "private addresses cannot receive
 * webhooks" while the field is still focused, rather than after a round trip.
 */
export function validateDraft(draft: IntegrationDraft): MutationResult {
  if (draft.name.trim().length < 2) {
    return { ok: false, message: "Give the integration a name you will recognise in a list." };
  }
  if (draft.events.length === 0) {
    return { ok: false, message: "Select at least one event, or the integration will never fire." };
  }

  const definition = PROVIDERS[draft.provider];

  if (definition.credential !== "none" && !draft.credential?.token) {
    return {
      ok: false,
      message: `${definition.label} needs a ${definition.credentialLabels?.token ?? "credential"}.`,
    };
  }

  if (definition.credential === "token+destination" && !draft.credential?.destination) {
    return {
      ok: false,
      message: `${definition.label} needs a ${definition.credentialLabels?.destination ?? "destination"}.`,
    };
  }

  // Telegram's endpoint is built from the bot token server-side, so there is no
  // URL for the operator to get wrong.
  if (definition.derivesUrl) return { ok: true };

  const check = checkWebhookUrl(draft.targetUrl, {
    ...(definition.allowedHosts ? { allowedHosts: definition.allowedHosts } : {}),
  });

  return check.ok ? { ok: true } : { ok: false, message: check.message ?? "That destination URL is not valid." };
}

export const useIntegrationStore = create<IntegrationState>()((set, get) => ({
  integrations: [],
  ready: false,
  loadError: null,
  sendingId: null,

  load: async () => {
    const result = await apiFetch<{ integrations: Integration[] }>("/api/integrations");
    if (!result.ok) {
      set({ ready: true, loadError: result.failure.message, integrations: [] });
      return;
    }
    set({ integrations: result.data.integrations, ready: true, loadError: null });
  },

  create: async (draft) => {
    const validation = validateDraft(draft);
    if (!validation.ok) return validation;

    const result = await apiPost<{ integration: Integration }>("/api/integrations", {
      provider: draft.provider,
      name: draft.name.trim(),
      targetUrl: draft.targetUrl.trim(),
      enabled: draft.enabled,
      events: draft.events,
      minSeverity: draft.minSeverity,
      credential: draft.credential ?? null,
    });
    if (!result.ok) return fail(result.failure);

    set((state) => ({ integrations: [result.data.integration, ...state.integrations] }));
    return { ok: true };
  },

  update: async (id, patch) => {
    const result = await apiPatch<{ integration: Integration }>(`/api/integrations/${id}`, {
      ...(patch.provider === undefined ? {} : { provider: patch.provider }),
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.targetUrl === undefined ? {} : { targetUrl: patch.targetUrl.trim() }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.events === undefined ? {} : { events: patch.events }),
      ...(patch.minSeverity === undefined ? {} : { minSeverity: patch.minSeverity }),
      // Omitted rather than sent as null when unchanged, so an edit cannot
      // accidentally clear a credential the browser never had.
      ...(patch.credential ? { credential: patch.credential } : {}),
    });
    if (!result.ok) return fail(result.failure);

    set((state) => ({
      integrations: state.integrations.map((entry) =>
        entry.id === id ? result.data.integration : entry,
      ),
    }));
    return { ok: true };
  },

  toggle: async (id) => {
    const current = get().integrations.find((entry) => entry.id === id);
    if (!current) return { ok: false, message: "That integration no longer exists." };
    return get().update(id, { enabled: !current.enabled });
  },

  remove: async (id) => {
    const result = await apiDelete<{ deleted: boolean }>(`/api/integrations/${id}`);
    if (!result.ok) return fail(result.failure);

    set((state) => ({ integrations: state.integrations.filter((entry) => entry.id !== id) }));
    return { ok: true };
  },

  trigger: async (id) => {
    set({ sendingId: id });

    const result = await apiPost<{ result: DeliveryResult }>("/api/integrations/trigger", {
      integrationId: id,
    });

    set({ sendingId: null });

    if (!result.ok) return { ok: false, message: result.failure.message };

    // The delivery outcome is stored server-side; mirror it locally so the card
    // updates without a refetch.
    set((state) => ({
      integrations: state.integrations.map((entry) =>
        entry.id === id ? { ...entry, lastDelivery: result.data.result } : entry,
      ),
    }));

    return { ok: result.data.result.ok, result: result.data.result };
  },
}));
