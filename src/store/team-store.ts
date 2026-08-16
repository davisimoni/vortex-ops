"use client";

import { create } from "zustand";

import { apiDelete, apiFetch, apiPatch, apiPost, type ApiFailure } from "@/lib/api-client";
import type { Permission, PermissionOverride } from "@/lib/rbac";
import type { MutationResult } from "@/store/incident-store";
import { usePreviewStore } from "@/store/session-store";
import type { Role, TeamMember } from "@/types";

interface TeamState {
  readonly members: readonly TeamMember[];
  readonly overrides: readonly PermissionOverride[];
  readonly ready: boolean;
  readonly loadError: string | null;

  load: () => Promise<void>;
  updateRole: (memberId: string, role: Role) => Promise<MutationResult>;
  invite: (name: string, email: string, role: Role) => Promise<MutationResult>;
  remove: (memberId: string) => Promise<MutationResult>;
  /** `granted: null` clears the override and restores the built-in default. */
  setOverride: (role: Role, permission: Permission, granted: boolean | null) => Promise<MutationResult>;
}

function fail(failure: ApiFailure): MutationResult {
  return { ok: false, message: failure.message };
}

export const useTeamStore = create<TeamState>()((set) => ({
  members: [],
  overrides: [],
  ready: false,
  loadError: null,

  load: async () => {
    const result = await apiFetch<{ members: TeamMember[]; overrides: PermissionOverride[] }>(
      "/api/team",
    );

    if (!result.ok) {
      set({ ready: true, loadError: result.failure.message, members: [] });
      return;
    }

    set({
      members: result.data.members,
      overrides: result.data.overrides,
      ready: true,
      loadError: null,
    });
    // The role preview needs this tenant's overrides to be an honest lens.
    usePreviewStore.getState().setOverrides(result.data.overrides);
  },

  updateRole: async (memberId, role) => {
    const result = await apiPatch<{ member: TeamMember }>(`/api/team/${memberId}`, { role });
    if (!result.ok) return fail(result.failure);

    set((state) => ({
      members: state.members.map((member) => (member.id === memberId ? result.data.member : member)),
    }));
    return { ok: true };
  },

  invite: async (name, email, role) => {
    const result = await apiPost<{ member: TeamMember }>("/api/team", { name, email, role });
    if (!result.ok) return fail(result.failure);

    set((state) => ({ members: [...state.members, result.data.member] }));
    return { ok: true };
  },

  remove: async (memberId) => {
    const result = await apiDelete<{ removed: boolean }>(`/api/team/${memberId}`);
    if (!result.ok) return fail(result.failure);

    set((state) => ({ members: state.members.filter((member) => member.id !== memberId) }));
    return { ok: true };
  },

  setOverride: async (role, permission, granted) => {
    const result = await apiPatch<{ overrides: PermissionOverride[] }>("/api/rbac", {
      role,
      permission,
      granted,
    });
    if (!result.ok) return fail(result.failure);

    set({ overrides: result.data.overrides });
    usePreviewStore.getState().setOverrides(result.data.overrides);
    return { ok: true };
  },
}));

/** Display name for a member id, for timeline entries and assignee chips. */
export function memberName(members: readonly TeamMember[], id: string | null): string | null {
  if (id === null) return null;
  return members.find((member) => member.id === id)?.name ?? null;
}

/** Members who can actually be assigned an incident. */
export function assignableMembers(members: readonly TeamMember[]): TeamMember[] {
  return members.filter((member) => member.status === "active");
}

/** Convenience selector used by the team page and the incident drawer alike. */
export function useTeamMembers(): readonly TeamMember[] {
  return useTeamStore((state) => state.members);
}

/** Kept out of `load` so a caller can refresh members without touching preview. */
export function currentOverrides(): readonly PermissionOverride[] {
  return useTeamStore.getState().overrides;
}
