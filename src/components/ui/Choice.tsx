"use client";

/** Segmented single-choice control (radio group) in pixel style. */
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
      <legend className="mb-3 font-display text-[10px] uppercase tracking-wide text-sun">{label}</legend>
      <div className="flex flex-wrap gap-3" role="radiogroup">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className="px-btn min-h-9 px-3 py-2 text-[10px]"
              style={
                active
                  ? ({ "--face": "var(--color-sun)", "--edge": "var(--color-sun-dark)", "--ink": "var(--color-ink-950)" } as React.CSSProperties)
                  : ({ "--face": "var(--color-ink-900)", "--frame": "var(--color-ink-400)", "--edge": "var(--color-ink-800)" } as React.CSSProperties)
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-display text-[10px] uppercase tracking-wide text-sun">{label}</p>
        {description && <p className="mt-1 text-base text-paper-dim">{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="px-btn min-h-9 w-20 shrink-0 text-[10px]"
        style={
          checked
            ? ({ "--face": "var(--color-mint)", "--edge": "var(--color-mint-dark)", "--ink": "var(--color-ink-950)" } as React.CSSProperties)
            : ({ "--face": "var(--color-ink-900)", "--frame": "var(--color-ink-400)", "--edge": "var(--color-ink-800)" } as React.CSSProperties)
        }
      >
        {checked ? "On" : "Off"}
      </button>
    </div>
  );
}
