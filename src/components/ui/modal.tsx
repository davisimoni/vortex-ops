"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** Defaults to a comfortable reading width; widen for content like a table or preview pane. */
  readonly widthClassName?: string;
}

/**
 * Centered dialog — the `Drawer`'s counterpart for content that isn't a
 * record's detail view (a slide-in panel would be an odd shape for a tour or
 * a confirmation).
 *
 * Deliberately its own copy of the focus-trap/scroll-lock logic rather than a
 * shared hook with `Drawer`: that component is exercised by existing E2E
 * coverage (`incidents.spec.ts`'s "closes the drawer with Escape"), and this
 * one is new — isolating them means a change here cannot regress that.
 */
export function Modal({ open, onClose, title, subtitle, children, footer, widthClassName }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!open) return;

      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = overflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "animate-slide-in relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl",
          "border border-hairline bg-surface shadow-2xl",
          widthClassName ?? "max-w-lg",
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-6 text-ink">{title}</h2>
            {subtitle ? <div className="mt-1 text-xs text-muted">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="border-t border-hairline bg-raised/50 px-5 py-3.5">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
