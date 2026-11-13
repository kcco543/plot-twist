"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { PixelIcon } from "./PixelIcon";

/** Menu window: plum frame, pink nameplate title, Esc / backdrop to close. Bottom sheet on phones. */
export function Modal({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
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
    ref.current?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea")?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <button aria-label={closeLabel} className="absolute inset-0 cursor-default bg-plum/40 backdrop-blur-[2px]" onClick={onClose} tabIndex={-1} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`px-frame relative mt-10 flex max-h-[85dvh] w-full ${width} animate-pop flex-col`}
        style={{ "--frame": "var(--frame-panel)" } as React.CSSProperties}
      >
        <div className="absolute -top-8 left-1 right-0 flex items-start justify-between gap-2">
          <h2 id={titleId} className="px-tab" style={{ borderImageSource: "var(--frame-pink)" }}>
            {title}
          </h2>
          <button onClick={onClose} className="px-btn size-11 shrink-0" style={{ "--frame": "var(--frame-ghost)", "--frame-pressed": "var(--frame-ghost-pressed)" } as React.CSSProperties} aria-label={closeLabel}>
            <PixelIcon name="close" size={12} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-2 pt-6 pb-3 sm:px-3">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-3 border-t-[3px] border-dashed border-line px-2 pt-3 pb-1">{footer}</footer>}
      </div>
    </div>
  );
}
