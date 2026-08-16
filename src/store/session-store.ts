"use client";

import { create } from "zustand";

import type { PermissionOverride } from "@/lib/rbac";
import type { Role } from "@/types";

/**
 * Client-side view state for the role preview.
 *
 * This is **not** authentication. The real role comes from the session cookie,
 * is resolved server-side against the membership table on every request, and is
 * what every API route enforces. What lives here is a UI lens: "show me this
 * page as a Viewer would see it", so an owner can check what they are shipping
 * without keeping three browser profiles open.
 *
 * The distinction is load-bearing and the banner says it out loud. Previously
 * this store *was* the authorisation model, which meant the disabled button was
 * the only thing standing between a viewer and a write. It is now a preview of
 * a decision made somewhere else.
 */

const PREVIEW_KEY = "vortex-preview-role";

const ROLE_VALUES: readonly string[] = ["owner", "devops", "viewer"];

function readPreviewRole(): Role | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(PREVIEW_KEY);
    return stored !== null && ROLE_VALUES.includes(stored) ? (stored as Role) : null;
  } catch {
    return null;
  }
}

function writePreviewRole(role: Role | null): void {
  if (typeof window === "undefined") return;
  try {
    if (role === null) window.sessionStorage.removeItem(PREVIEW_KEY);
    else window.sessionStorage.setItem(PREVIEW_KEY, role);
  } catch {
    /* Private-mode storage throws; the preview still applies in-memory. */
  }
}

interface PreviewState {
  readonly previewRole: Role | null;
  /** This organisation's deviations from the default matrix, for the preview. */
  readonly overrides: readonly PermissionOverride[];

  setPreviewRole: (role: Role | null) => void;
  setOverrides: (overrides: readonly PermissionOverride[]) => void;
  restore: () => void;
}

export const usePreviewStore = create<PreviewState>()((set) => ({
  previewRole: null,
  overrides: [],

  setPreviewRole: (role) => {
    writePreviewRole(role);
    set({ previewRole: role });
  },

  setOverrides: (overrides) => set({ overrides }),

  // Storage does not exist during the server render; restored in an effect.
  restore: () => set({ previewRole: readPreviewRole() }),
}));
