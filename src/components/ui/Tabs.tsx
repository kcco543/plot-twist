"use client";

import { useId, useRef, type ReactNode } from "react";
import { buttonStyle } from "./PixelButton";
import { PixelIcon, type IconName } from "./PixelIcon";

export type TabItem<T extends string> = { id: T; label: string; icon?: IconName; badge?: string | number };

/**
 * Candy-button tab strip with full keyboard support (← → Home End).
 * Render the active panel yourself inside <TabPanel>.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  size = "md",
  idBase,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  idBase?: string;
}) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + items.length) % items.length;
    onChange(items[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={`px-tabbar -mx-1 px-1 pb-2 ${size === "sm" ? "flex-wrap" : ""}`}>
      {items.map((it, i) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${base}-tab-${it.id}`}
            aria-selected={active}
            aria-controls={`${base}-panel-${it.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") move(i + 1);
              else if (e.key === "ArrowLeft") move(i - 1);
              else if (e.key === "Home") move(0);
              else if (e.key === "End") move(items.length - 1);
              else return;
              e.preventDefault();
            }}
            className={`px-btn shrink-0 ${size === "sm" ? "min-h-10 px-1 text-[14px]" : "min-h-11 px-2 text-[15px]"}`}
            style={buttonStyle(active ? "accent" : "ghost")}
          >
            {it.icon && <PixelIcon name={it.icon} size={12} />}
            <span>{it.label}</span>
            {it.badge !== undefined && it.badge !== 0 && <span className="bg-coral px-1 font-label text-[10px] leading-4 text-ink">{it.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, base, active, children, className = "" }: { id: string; base: string; active: boolean; children: ReactNode; className?: string }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`${base}-panel-${id}`} aria-labelledby={`${base}-tab-${id}`} className={className}>
      {children}
    </div>
  );
}
