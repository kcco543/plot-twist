"use client";

import { buttonStyle } from "./PixelButton";

/** Segmented single choice (radio group) using candy buttons. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 font-label text-xs uppercase tracking-wide text-butter">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className="px-btn min-h-11 px-2 text-[15px]"
              style={buttonStyle(active ? "accent" : "ghost")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  onLabel,
  offLabel,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-label text-xs uppercase tracking-wide text-butter">{label}</p>
        {description && <p className="mt-1 text-base leading-snug text-cream-dim">{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="px-btn min-h-11 w-20 shrink-0 text-[15px]"
        style={buttonStyle(checked ? "success" : "ghost")}
      >
        {checked ? onLabel : offLabel}
      </button>
    </div>
  );
}
