"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PixelIcon, type IconName } from "@/components/ui/PixelIcon";
import { intersect, placeMenu, type Rect } from "@/lib/keepsakes/menuPlacement";
import type { Availability } from "@/lib/explore/interact";
import type { ObjectAction } from "@/lib/stage/objects";
import { useI18n } from "@/i18n";

const ICONS: Partial<Record<ObjectAction, IconName>> = {
  open: "unlock",
  close: "lock",
  unlock: "unlock",
  knock: "hand",
  leave: "right",
  enter: "sparkle",
  climb: "up",
  talk: "chat",
  order: "star",
  sit: "down",
  rest: "heart",
  read: "book",
  browse: "book",
  search: "eye",
  place: "gift",
  look_out: "eye",
  examine: "eye",
  inspect: "eye",
  admire: "heart",
  pick_up: "hand",
};

/**
 * Compact action menu next to an object (drag a character onto something with
 * several things to do, or tap the object while a character is selected).
 * Blocked actions stay visible, greyed, with the reason ("Locked"), so the
 * player learns why. Follows the object while the camera moves; Esc or a
 * press outside closes it.
 */
export function ObjectActionMenu({
  title,
  actions,
  anchor,
  onPick,
  onClose,
}: {
  title: string;
  actions: Availability[];
  /** The object's box on screen right now (client px), or null when it's gone. */
  anchor: () => Rect | null;
  onPick: (a: ObjectAction) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number; side: "above" | "below"; arrowX: number } | null>(null);
  const cb = useRef({ onClose, onPick, anchor });
  cb.current = { onClose, onPick, anchor };

  useLayoutEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const a = cb.current.anchor();
      const menu = ref.current;
      if (!a) return cb.current.onClose();
      if (menu) {
        const stage = document.querySelector<HTMLElement>("[data-stage-view]");
        const screen: Rect = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const bounds = stage ? intersect(stage.getBoundingClientRect(), screen) : screen;
        const next = placeMenu(a, { width: menu.offsetWidth, height: menu.offsetHeight }, bounds);
        const key = `${next.left},${next.top},${next.side}`;
        if (key !== last) {
          last = key;
          setPos(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (pos && !ref.current?.contains(document.activeElement)) items.current.find((b) => b && !b.disabled)?.focus({ preventScroll: true });
  }, [pos]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      cb.current.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cb.current.onClose();
    };
    // Next tick: the press that opened the menu must not close it.
    const id = window.setTimeout(() => document.addEventListener("pointerdown", down, true), 0);
    window.addEventListener("keydown", key, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      data-object-menu
      className="bubble fixed z-40 animate-pop"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden", width: "max-content", maxWidth: "min(18rem, calc(100vw - 12px))" } as CSSProperties}
    >
      <div className="bubble-body relative px-2 pt-1.5 pb-2">
        <p className="mb-1.5 truncate font-label text-[10px] uppercase tracking-wide text-label">{title}</p>
        <div className="flex flex-col gap-1">
          {actions.map((a, i) => (
            <button
              key={a.action}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              disabled={!a.ok}
              data-object-action={a.action}
              onClick={() => cb.current.onPick(a.action)}
              className="px-focus flex min-h-10 items-center gap-2 bg-well py-1 pr-2.5 pl-1 text-left font-head text-[15px] font-bold text-ink enabled:hover:bg-butter-hi disabled:cursor-not-allowed disabled:text-ink-mute"
              style={{ boxShadow: "inset 0 0 0 2px var(--color-line)" }}
            >
              <span className="grid size-7 shrink-0 place-items-center bg-surface text-label" style={{ boxShadow: "inset 0 0 0 2px var(--color-line)" }}>
                <PixelIcon name={ICONS[a.action] ?? "eye"} size={12} />
              </span>
              <span className="flex-1">{t(`objects.actions.${a.action}`)}</span>
              {!a.ok && <span className="font-label text-[9px] uppercase text-coral-deep">{t(`explore.unavailable.${a.reason}`)}</span>}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => cb.current.onClose()} className="px-focus min-h-9 px-2 text-left font-label text-[10px] uppercase text-ink-soft hover:text-ink">
            {t("explore.menu.cancel")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
