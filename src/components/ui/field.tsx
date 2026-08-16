"use client";

import { ChevronDown } from "lucide-react";
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Form primitives.
 *
 * Every control is wrapped by `Field`, which owns the label/description/error
 * wiring: `htmlFor`, `aria-describedby` and `aria-invalid` are set from one
 * place so no control can ship with a label that is only visually adjacent.
 */

export interface FieldProps {
  readonly label: string;
  readonly description?: string;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    "aria-required": boolean | undefined;
  }) => ReactNode;
}

export function Field({
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/*
        The required marker is drawn with a pseudo-element rather than a real
        element. It is decoration: "required" reaches assistive tech through
        `aria-required` on the control below, and keeping the glyph out of the
        DOM means the label's text is exactly its text — which is what both a
        screen reader and `getByLabel` read.
      */}
      <label
        htmlFor={id}
        data-required={required || undefined}
        className="text-xs font-medium text-ink2 data-[required]:after:ml-0.5 data-[required]:after:text-[var(--status-critical)] data-[required]:after:content-['*']"
      >
        {label}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })}

      {description ? (
        <p id={descriptionId} className="text-xs leading-relaxed text-muted">
          {description}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  "w-full rounded-lg border border-hairline bg-plane px-3 text-sm text-ink " +
  "placeholder:text-muted transition-colors " +
  "hover:border-hairline-strong " +
  "aria-[invalid=true]:border-crit " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_BASE, "h-9", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(CONTROL_BASE, "min-h-[76px] resize-y py-2 leading-relaxed", className)}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(CONTROL_BASE, "h-9 appearance-none pr-9", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
      </div>
    );
  },
);

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  /** Hides the visible label, keeping it for assistive tech. */
  readonly hideLabel?: boolean;
  readonly id?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  hideLabel = false,
  id,
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;

  return (
    <div className="inline-flex items-center gap-2.5">
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-45",
          checked ? "bg-brand" : "bg-[var(--axis)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-3.5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4.5" : "translate-x-1",
          )}
        />
      </button>
      {hideLabel ? null : (
        <label htmlFor={switchId} className="cursor-pointer text-sm text-ink2">
          {label}
        </label>
      )}
    </div>
  );
}
