"use client";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Announced instead of the abbreviated label ("1h" → "Last hour"). */
  readonly description?: string;
}

export interface SegmentedProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Names the group for assistive tech — required, never optional. */
  readonly label: string;
  readonly className?: string;
}

/**
 * A radio group styled as a segmented control.
 *
 * Real radio inputs, not buttons: arrow-key navigation, group semantics and
 * form association come free, and a custom `role="tablist"` would have to
 * reimplement all three badly.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-hairline bg-raised p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
              "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--brand)]",
              selected ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
            title={option.description ?? option.label}
          >
            {/*
              A transparent input stretched over the whole label, rather than a
              1px `sr-only` box. The hit target is then the segment you can see —
              which is what the 24px minimum is about — instead of a pixel in its
              corner that a thumb cannot land on.
            */}
            <input
              type="radio"
              name={label}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span aria-hidden={option.description ? "true" : undefined}>{option.label}</span>
            {option.description ? <span className="sr-only">{option.description}</span> : null}
          </label>
        );
      })}
    </div>
  );
}
