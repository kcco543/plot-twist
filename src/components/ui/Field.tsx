import { useId } from "react";
import { PixelIcon } from "./PixelIcon";

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
  /** Lock toggle: locked fields are canon the AI must keep as written. */
  lock?: { locked: boolean; onToggle: () => void; lockLabel: string; unlockLabel: string; lockedText: string };
  /** Marks the wrapper (data-field) so other UI can scroll to and focus this field. */
  fieldKey?: string;
};

/**
 * Labeled text field. Plain controlled input/textarea, so IME composition
 * (Chinese pinyin, Japanese, etc.) works natively.
 */
export function Field({ label, value, onChange, placeholder, multiline, rows = 3, maxLength, hint, className = "", lock, fieldKey }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div data-field={fieldKey} className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-label text-xs uppercase tracking-wide text-label">
          {label}
        </label>
        <span className="flex items-center gap-2">
          {maxLength && (
            <span className="font-label text-[10px] text-ink-mute tabular-nums" aria-hidden>
              {value.length}/{maxLength}
            </span>
          )}
          {lock && (
            <button
              type="button"
              onClick={lock.onToggle}
              aria-pressed={lock.locked}
              aria-label={lock.locked ? lock.unlockLabel : lock.lockLabel}
              title={lock.locked ? lock.unlockLabel : lock.lockLabel}
              className={`px-focus -my-2 inline-flex min-h-9 min-w-9 items-center justify-center gap-1 px-1 font-label text-[10px] uppercase ${lock.locked ? "bg-butter-hi text-label shadow-[inset_0_0_0_2px_var(--color-butter-lo)]" : "text-ink-mute hover:text-label"}`}
            >
              <PixelIcon name={lock.locked ? "lock" : "unlock"} size={11} />
              {lock.locked && <span>{lock.lockedText}</span>}
            </button>
          )}
        </span>
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
