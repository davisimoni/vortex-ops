"use client";

import { create } from "zustand";

import { shortId } from "@/lib/utils";

export type ToastTone = "info" | "success" | "warning" | "critical";

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly body?: string;
  /** Milliseconds before auto-dismiss. `null` keeps it until dismissed. */
  readonly ttlMs: number | null;
}

interface ToastState {
  readonly toasts: readonly Toast[];
  push: (toast: Omit<Toast, "id" | "ttlMs"> & { ttlMs?: number | null }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Cap the stack: a queue of twelve toasts is a wall, not a notification. */
const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  push: (toast) => {
    const id = shortId("toast");
    const entry: Toast = {
      id,
      tone: toast.tone,
      title: toast.title,
      ...(toast.body === undefined ? {} : { body: toast.body }),
      // Critical alerts stay until acknowledged; everything else expires.
      ttlMs: toast.ttlMs === undefined ? (toast.tone === "critical" ? null : 6_000) : toast.ttlMs,
    };

    set((state) => ({ toasts: [entry, ...state.toasts].slice(0, MAX_TOASTS) }));
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  clear: () => set({ toasts: [] }),
}));
