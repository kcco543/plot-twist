import type { CSSProperties, ReactNode } from "react";

export type FrameName = "panel" | "card" | "cream" | "gold" | "gold-card" | `world-${string}`;

/**
 * Framed surface. `title` renders as a nameplate tab on the top edge
 * (the same motif as dialogue speaker names and modal titles).
 */
export function Panel({
  children,
  className = "",
  frame = "panel",
  title,
  titleRight,
  as: Tag = "section",
  padded = true,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  frame?: FrameName;
  title?: ReactNode;
  titleRight?: ReactNode;
  as?: "section" | "div" | "aside";
  padded?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Tag
      aria-label={ariaLabel}
      className={`px-frame px-shadow relative ${title ? "mt-5" : ""} ${className}`}
      style={{ "--frame": `var(--frame-${frame})` } as CSSProperties}
    >
      {title && (
        <div className="absolute -top-7 left-1 right-1 flex items-start justify-between gap-2 sm:-top-8">
          <h2 className="px-tab">{title}</h2>
          {titleRight}
        </div>
      )}
      <div className={`${padded ? "p-2 sm:p-3" : ""} ${title ? "pt-4 sm:pt-5" : ""} h-full`}>{children}</div>
    </Tag>
  );
}
