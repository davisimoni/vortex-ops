"use client";

import { create } from "zustand";

/**
 * Just the open/closed flag, in its own tiny store.
 *
 * The palette's own keyboard listener lives inside `CommandPalette` and could
 * own this as local state — except the palette needs a *visible* way to open
 * it too. `⌘K`/`Ctrl+K` does not exist on a phone, and this app is used on
 * one more than at a desk (see the README's own framing throughout). A
 * button in the topbar has to be able to open the same dialog, so the flag
 * lives here instead of trapped inside the component that also renders it.
 */
interface CommandPaletteState {
  readonly open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
