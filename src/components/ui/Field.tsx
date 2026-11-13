import { useId } from "react";

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  hint?: string;
  className?: string;
};

export function Field({ label, value, onChange, placeholder, multiline, rows = 3, maxLength, hint, className = "" }: Props) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-display text-[10px] uppercase tracking-wide text-sun">
          {label}
        </label>
        {maxLength && (
          <span className="text-sm text-ink-400" aria-hidden>
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      {multiline ? (
        <textarea
          id={id}
          className="px-input resize-y"
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="px-input"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <p className="text-sm text-paper-dim">{hint}</p>}
    </div>
  );
}
