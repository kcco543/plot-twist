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

/**
 * Labeled text field. Plain controlled input/textarea, so IME composition
 * (Chinese pinyin, Japanese, etc.) works natively.
 */
export function Field({ label, value, onChange, placeholder, multiline, rows = 3, maxLength, hint, className = "" }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-label text-xs uppercase tracking-wide text-label">
          {label}
        </label>
        {maxLength && (
          <span className="font-label text-[10px] text-ink-mute tabular-nums" aria-hidden>
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
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="px-input"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      )}
    </div>
  );
}
