"use client";

import { AlertTriangle, CheckCircle2, Flame, Info, X, type LucideIcon } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";
import { useToastStore, type Toast, type ToastTone } from "@/store/toast-store";

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: Flame,
};

const TONE_ACCENT: Record<ToastTone, string> = {
  info: "bg-brand",
  success: "bg-good",
  warning: "bg-warn",
  critical: "bg-crit",
};

const TONE_ICON_COLOR: Record<ToastTone, string> = {
  info: "text-brand",
  success: "text-good",
  warning: "text-warn",
  critical: "text-crit",
};

function ToastCard({ toast }: { readonly toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const Icon = TONE_ICON[toast.tone];

  useEffect(() => {
    if (toast.ttlMs === null) return undefined;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.ttlMs);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.ttlMs, dismiss]);

  return (
    <div
      className={cn(
        "animate-slide-in pointer-events-auto relative flex w-full gap-3 overflow-hidden",
        "rounded-xl border border-hairline bg-surface p-3 pr-2 shadow-[var(--shadow-card)]",
      )}
    >
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-0.5", TONE_ACCENT[toast.tone])} />
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", TONE_ICON_COLOR[toast.tone])} />

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-5 text-ink">{toast.title}</p>
        {toast.body ? <p className="mt-0.5 text-xs leading-relaxed text-ink2">{toast.body}</p> : null}
      </div>

      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label={`Dismiss: ${toast.title}`}
        className="h-fit rounded-md p-1 text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Toast region.
 *
 * `role="status"` with `aria-live="polite"` rather than `alert`/`assertive`:
 * on a live dashboard an assertive region would interrupt a screen-reader user
 * mid-sentence every time a sample crosses a threshold.
 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-relevant="additions"
      className={cn(
        "pointer-events-none fixed z-[60] flex flex-col gap-2",
        "inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[360px]",
      )}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
