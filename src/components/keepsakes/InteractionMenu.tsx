"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PixelIcon, type IconName } from "@/components/ui/PixelIcon";
import { intersect, placeMenu, type Rect } from "@/lib/keepsakes/menuPlacement";
import { useI18n } from "@/i18n";

export type InteractionKind = "photo" | "gift";

const TALK = { kind: "talk" as const, icon: "chat" as IconName, tile: "var(--color-lavender-hi)", ink: "var(--color-label)" };
const OPTIONS: { kind: InteractionKind; icon: IconName; tile: string; ink: string }[] = [
  { kind: "photo", icon: "camera", tile: "var(--color-pink-hi)", ink: "var(--color-rose)" },
  { kind: "gift", icon: "gift", tile: "var(--color-mint-hi)", ink: "var(--color-mint-deep)" },
];

const rectOf = (r: DOMRect | { left: number; top: number; right: number; bottom: number }): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/**
 * Small pixel menu that pops up next to a character after a click / tap:
 * Photo and Gift. It follows the character while they walk, stays inside the
 * visible part of the game view, and closes on Esc, a click / tap outside, or
 * once an option is picked.
 *
 * The character sprite is found by its data-actor attribute; the visible part
 * of the stage by [data-stage-view] (the stage's clipping box).
 */
export function InteractionMenu({
  characterId,
  name,
  onPick,
  onClose,
  unavailable = null,
  onTalk,
}: {
  characterId: string;
  name: string;
  onPick: (kind: InteractionKind) => void;
  onClose: () => void;
  /** When set, the options are shown but disabled, with this explanation. */
  unavailable?: string | null;
  /** "Talk to…": the click / tap way to start a conversation (the alternative to dragging). Hidden when not possible. */
  onTalk?: (() => void) | null;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number; side: "above" | "below"; arrowX: number } | null>(null);
  const cb = useRef({ onClose, onPick, onTalk });
  cb.current = { onClose, onPick, onTalk };

  const sprite = useCallback(() => document.querySelector<HTMLElement>(`[data-actor="${CSS.escape(characterId)}"]`), [characterId]);

  // Follow the character every frame (they may be walking; the camera may pan).
  useLayoutEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const el = sprite();
      const menu = ref.current;
      if (!el) {
        cb.current.onClose(); // the character left the stage
        return;
      }
      if (menu) {
        const stage = el.closest<HTMLElement>("[data-stage-view]");
        const vv = window.visualViewport;
        const screen: Rect = vv ? { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height } : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const bounds = stage ? intersect(rectOf(stage.getBoundingClientRect()), screen) : screen;
        const next = placeMenu(rectOf(el.getBoundingClientRect()), { width: menu.offsetWidth, height: menu.offsetHeight }, bounds);
        const key = `${next.left},${next.top},${next.side},${next.arrowX}`;
        if (key !== last) {
          last = key;
          setPos(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [sprite]);

  // Focus the first option so keyboard players can carry on straight away.
  useEffect(() => {
    if (pos && !ref.current?.contains(document.activeElement)) items.current.find((b) => b && !b.disabled)?.focus({ preventScroll: true });
  }, [pos]);

  // Close on a press anywhere else, and on Esc (before the page's own Esc = pause).
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || ref.current?.contains(target)) return;
      // Pressing the same character again is handled by its click (toggles the menu).
      if (sprite()?.contains(target)) return;
      cb.current.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        cb.current.onClose();
        sprite()?.focus({ preventScroll: true });
        return;
      }
      if (!ref.current?.contains(document.activeElement)) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const live = items.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled);
        if (!live.length) return;
        const i = live.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
        live[(i + step + live.length) % live.length].focus();
      }
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [sprite]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t("keepsakes.menu.label", { name })}
      data-interaction-menu={characterId}
      className="bubble fixed z-40 animate-pop"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden", width: "max-content", maxWidth: "calc(100vw - 12px)" } as CSSProperties}
    >
      <div className="bubble-body relative px-2 pt-1.5 pb-2">
        <p className="mb-1.5 flex items-center gap-1.5 truncate font-label text-[10px] uppercase tracking-wide text-label">
          <PixelIcon name="heart" size={8} className="text-pink-lo" />
          <span className="truncate">{name}</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[...(onTalk ? [TALK] : []), ...OPTIONS].map((o, i) => {
            const off = o.kind !== "talk" && !!unavailable;
            return (
              <button
                key={o.kind}
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitem"
                disabled={off}
                data-interaction={o.kind}
                onClick={() => (o.kind === "talk" ? cb.current.onTalk?.() : cb.current.onPick(o.kind))}
                className="px-focus group flex min-h-11 min-w-[4.75rem] items-center gap-2 py-1 pr-2.5 pl-1 text-left font-head text-[15px] font-bold text-ink transition-transform duration-75 enabled:hover:-translate-y-px enabled:active:translate-y-px disabled:cursor-not-allowed disabled:text-ink-mute"
                style={{ background: o.tile, boxShadow: `inset 0 0 0 2px ${off ? "var(--color-line)" : "color-mix(in srgb, " + o.ink + " 35%, transparent)"}, inset 0 -3px 0 0 color-mix(in srgb, ${o.ink} 18%, transparent)` }}
              >
                <span className="grid size-8 shrink-0 place-items-center bg-surface" style={{ color: off ? "var(--color-ink-mute)" : o.ink, boxShadow: "inset 0 0 0 2px var(--color-line)" }}>
                  <PixelIcon name={o.icon} size={16} />
                </span>
                {t(`keepsakes.menu.${o.kind}`)}
              </button>
            );
          })}
        </div>
        {unavailable && <p className="mt-1.5 max-w-[13rem] text-xs leading-snug text-ink-soft">{unavailable}</p>}
        {/* Pixel pointer at the character */}
        {pos && (
          <svg
            aria-hidden
            width={12}
            height={8}
            viewBox="0 0 6 4"
            shapeRendering="crispEdges"
            className="absolute"
            style={{ left: pos.arrowX - 6, ...(pos.side === "above" ? { bottom: -8 } : { top: -8, transform: "scaleY(-1)" }) }}
          >
            <rect x={0} y={0} width={6} height={1} fill="var(--color-surface)" />
            <rect x={1} y={1} width={4} height={1} fill="var(--color-surface)" />
            <rect x={2} y={2} width={2} height={1} fill="var(--color-surface)" />
            <rect x={0} y={0} width={1} height={1} fill="var(--color-lavender-lo)" />
            <rect x={5} y={0} width={1} height={1} fill="var(--color-lavender-lo)" />
            <rect x={1} y={1} width={1} height={1} fill="var(--color-lavender-lo)" />
            <rect x={4} y={1} width={1} height={1} fill="var(--color-lavender-lo)" />
            <rect x={2} y={2} width={2} height={2} fill="var(--color-lavender-lo)" />
          </svg>
        )}
      </div>
    </div>,
    document.body,
  );
}
