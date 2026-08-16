"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  /** Renders a spinner and blocks interaction without changing the width. */
  readonly loading?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-brand-contrast hover:opacity-90 border border-transparent",
  secondary: "bg-raised text-ink border border-hairline hover:border-hairline-strong",
  ghost: "bg-transparent text-ink2 hover:bg-raised hover:text-ink border border-transparent",
  danger: "bg-transparent text-crit border border-crit/40 hover:bg-crit/10",
};

const SIZE: Record<Size, string> = {
  // 32px and 36px tall — both clear the 24px minimum hit target with room for
  // a mis-tap on a phone, which is where half of on-call work happens.
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-lg font-medium",
        "transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-45",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
});
