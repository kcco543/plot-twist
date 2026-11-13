"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { PixelIcon } from "./PixelIcon";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button aria-label="Close" className="absolute inset-0 bg-ink-950/80 cursor-default" onClick={onClose} tabIndex={-1} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`px-panel relative flex max-h-[85dvh] w-full ${width} animate-pop flex-col`}
        style={{ "--frame": "var(--color-paper)" } as React.CSSProperties}
      >
        <header className="flex items-center justify-between gap-3 border-b-4 border-ink-950 bg-twist px-4 py-3">
          <h2 id={titleId} className="font-display text-xs uppercase leading-none text-paper">
            {title}
          </h2>
          <button onClick={onClose} className="px-focus p-1 text-paper hover:text-sun" aria-label="Close">
            <PixelIcon name="close" size={14} />
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-4 border-t-4 border-ink-950 p-4">{footer}</footer>}
      </div>
    </div>
  );
}
