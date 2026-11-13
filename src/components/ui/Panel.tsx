import type { CSSProperties, ReactNode } from "react";

export function Panel({
  children,
  className = "",
  frame,
  title,
  titleRight,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  /** Border color (CSS color/var). */
  frame?: string;
  title?: ReactNode;
  titleRight?: ReactNode;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag className={`px-panel ${className}`} style={frame ? ({ "--frame": frame } as CSSProperties) : undefined}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b-4 border-ink-950 bg-ink-700 px-4 py-3">
          <h2 className="font-display text-[11px] uppercase leading-none tracking-wide text-paper">{title}</h2>
          {titleRight}
        </header>
      )}
      {children}
    </Tag>
  );
}
