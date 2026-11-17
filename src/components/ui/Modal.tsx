"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
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

  if (!open || typeof document === "undefined") return null;
  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : size === "xl" ? "sm:max-w-4xl" : size === "2xl" ? "sm:max-w-6xl" : "sm:max-w-lg";

  // Portalled to <body>: a parent with a filter or transform (framed panels use drop-shadow
  // filters) would otherwise trap a fixed-position window inside itself.
  return createPortal(
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
        className={`px-frame px-panel relative mt-10 flex max-h-[85dvh] w-full ${width} animate-pop flex-col`}
        style={{ "--frame": "var(--frame-panel)" } as React.CSSProperties}
      >
        <div className="panel-tab-row absolute -top-8 !right-0 flex items-start justify-between gap-2">
          <h2 id={titleId} className="px-tab" style={{ borderImageSource: "var(--frame-pink)" }}>
            {title}
          </h2>
          <button onClick={onClose} className="px-btn size-11 shrink-0" style={{ "--frame": "var(--frame-ghost)", "--frame-pressed": "var(--frame-ghost-pressed)" } as React.CSSProperties} aria-label={closeLabel}>
            <PixelIcon name="close" size={12} />
          </button>
        </div>
        <div className="panel-pad-x min-h-0 flex-1 overflow-y-auto overscroll-contain pt-6 pb-3" data-modal-body>{children}</div>
        {footer && <footer className="panel-pad-x flex shrink-0 flex-wrap justify-end gap-3 border-t-[3px] border-dashed border-line pt-3 pb-1">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
