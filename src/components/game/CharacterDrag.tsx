"use client";

/**
 * Drag a character onto another one to make them walk over and talk.
 *
 *  - useCharacterDrag(): pointer handling (mouse, pen, touch-and-hold), using
 *    the click-vs-drag rules in src/lib/talk/drag.ts. A plain click / tap is
 *    left alone, so it still selects the character.
 *  - DragOverlay: the preview drawn while dragging (route dots, target ring,
 *    a short label), and the rings around possible targets in tap-to-target mode.
 *
 * The drag position lives in a tiny store read only by the overlay, so moving
 * the pointer never re-renders the whole play screen.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { DRAG, hitCharacter, pressState, toStagePoint, type PointerKind, type PressState } from "@/lib/talk/drag";
import type { Point } from "@/lib/stage/room";
import type { ActorView, StageSim } from "@/lib/stage/sim";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";
import { STAGE } from "./SceneSprites";

export type DragView = {
  actorId: string;
  point: Point;
  targetId: string | null;
  /** Route preview to the target: points, [] already close, null = can't get there. */
  route: Point[] | null;
  kind: PointerKind;
} | null;

class DragStore {
  private v: DragView = null;
  private ls = new Set<() => void>();
  get = () => this.v;
  set(v: DragView) {
    this.v = v;
    this.ls.forEach((l) => l());
  }
  subscribe = (l: () => void) => {
    this.ls.add(l);
    return () => this.ls.delete(l);
  };
}

type Press = {
  id: string;
  pointerId: number;
  kind: PointerKind;
  x0: number;
  y0: number;
  t0: number;
  state: PressState;
  box: DOMRect;
  hold: number;
  lastTarget: string | null;
  route: Point[] | null;
};

export function useCharacterDrag({
  stage,
  canDrag,
  distanceFor,
  onDrop,
  onDropEmpty,
}: {
  stage: StageSim;
  /** False while a menu is open, the player is typing, etc. */
  canDrag: () => boolean;
  /** Conversation distance for a pair (for the route preview). */
  distanceFor: (actorId: string, targetId: string) => number;
  onDrop: (actorId: string, targetId: string) => void;
  onDropEmpty: (actorId: string) => void;
}) {
  const store = useRef(new DragStore()).current;
  const press = useRef<Press | null>(null);
  const swallowClickUntil = useRef(0);
  const cbs = useRef({ canDrag, distanceFor, onDrop, onDropEmpty });
  cbs.current = { canDrag, distanceFor, onDrop, onDropEmpty };

  const clear = useCallback(
    (swallow: boolean) => {
      const p = press.current;
      if (p) window.clearTimeout(p.hold);
      press.current = null;
      if (swallow) swallowClickUntil.current = performance.now() + 400;
      store.set(null);
      document.documentElement.classList.remove("is-dragging-character");
    },
    [store],
  );

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const p = press.current;
      if (!p || p.state !== "drag") return;
      const pt = toStagePoint(clientX, clientY, p.box, STAGE);
      const target = hitCharacter(stage.getSnapshot().actors, pt, p.id, p.kind);
      if (target !== p.lastTarget) {
        p.lastTarget = target;
        p.route = target ? stage.previewApproach(p.id, target, cbs.current.distanceFor(p.id, target)) : null;
      }
      store.set({ actorId: p.id, point: pt, targetId: target, route: target ? p.route : null, kind: p.kind });
    },
    [stage, store],
  );

  const startDrag = useCallback(
    (clientX: number, clientY: number) => {
      const p = press.current;
      if (!p) return;
      p.state = "drag";
      document.documentElement.classList.add("is-dragging-character");
      if (p.kind === "touch") navigator.vibrate?.(8);
      update(clientX, clientY);
    },
    [update],
  );

  // Window listeners for the whole press (the pointer can leave the sprite).
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const next = pressState(p.kind, e.clientX - p.x0, e.clientY - p.y0, performance.now() - p.t0, p.state);
      if (next === "cancel") return clear(false);
      if (next === "drag" && p.state !== "drag") startDrag(e.clientX, e.clientY);
      if (p.state === "drag") {
        e.preventDefault();
        update(e.clientX, e.clientY);
      }
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (p.state !== "drag") return clear(false); // a click / tap: the button's click selects
      const v = store.get();
      clear(true);
      if (!v) return;
      if (v.targetId) cbs.current.onDrop(p.id, v.targetId);
      else if (hitCharacter(stage.getSnapshot().actors, v.point, null, p.kind) !== p.id) cbs.current.onDropEmpty(p.id);
      // Dropped back on itself: just cancel.
    };
    const cancel = (e: PointerEvent) => {
      if (press.current && e.pointerId === press.current.pointerId) clear(press.current.state === "drag");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && press.current?.state === "drag") {
        e.preventDefault();
        e.stopImmediatePropagation();
        clear(true);
      }
    };
    // Touch: while dragging, the page must not scroll (sprites also have touch-action: none).
    const touchmove = (e: TouchEvent) => {
      if (press.current?.state === "drag") e.preventDefault();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("touchmove", touchmove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("touchmove", touchmove);
      clear(false);
    };
  }, [clear, startDrag, update, store, stage]);

  /** pointerdown on a character sprite. */
  const onPressStart = useCallback(
    (id: string, e: ReactPointerEvent<HTMLElement>) => {
      if (press.current || (e.pointerType === "mouse" && e.button !== 0) || !e.isPrimary) return;
      if (!cbs.current.canDrag()) return;
      // The sprite sits inside the scaled art layer: its box maps client px → art px.
      const layer = e.currentTarget.parentElement;
      if (!layer) return;
      const kind: PointerKind = e.pointerType === "touch" ? "touch" : e.pointerType === "pen" ? "pen" : "mouse";
      const p: Press = { id, pointerId: e.pointerId, kind, x0: e.clientX, y0: e.clientY, t0: performance.now(), state: "pending", box: layer.getBoundingClientRect(), hold: 0, lastTarget: null, route: null };
      press.current = p;
      if (kind === "touch") {
        const { clientX, clientY } = e;
        // Touch-and-hold lifts the character (if the finger hasn't wandered off).
        p.hold = window.setTimeout(() => {
          if (press.current === p && p.state === "pending") startDrag(clientX, clientY);
        }, DRAG.holdMs);
      }
    },
    [startDrag],
  );

  /** True if a click right now is the tail end of a drag (and must not select). */
  const swallowClick = useCallback(() => performance.now() < swallowClickUntil.current, []);
  const dragging = useSyncExternalStore(store.subscribe, () => store.get() !== null, () => false);

  return { store, onPressStart, swallowClick, dragging, cancel: () => clear(true) };
}

export function useDragView(store: { subscribe: (l: () => void) => () => void; get: () => DragView }): DragView {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

const pct = (x: number, total: number) => `${(x / total) * 100}%`;
const RING = { halfW: 13, top: 34, bottom: 4 };

/** Brackets around a character (art px), drawn in the overlay so they stay crisp. */
function Ring({ a, tone, pulse = false }: { a: ActorView; tone: "ok" | "bad" | "pick" | "self"; pulse?: boolean }) {
  const color = tone === "ok" ? "var(--color-mint-deep)" : tone === "bad" ? "var(--color-coral-deep)" : tone === "self" ? "var(--color-label)" : "var(--color-rose)";
  return (
    <span
      aria-hidden
      className={`absolute ${pulse ? "animate-pulse" : ""}`}
      style={{
        left: pct(a.x - RING.halfW, STAGE.width),
        top: pct(a.y - RING.top, STAGE.height),
        width: pct(RING.halfW * 2, STAGE.width),
        height: pct(RING.top + RING.bottom, STAGE.height),
        border: `2px ${tone === "pick" || tone === "self" ? "dashed" : "solid"} ${color}`,
        boxShadow: tone === "ok" ? "0 0 0 2px rgb(255 255 255 / 0.7)" : undefined,
      }}
    />
  );
}

/**
 * Overlay for the drag preview and tap-to-target mode.
 * `choices`: characters you can tap as a target right now (tap-to-target).
 */
export function DragOverlay({
  view,
  actors,
  characters,
  chooser,
}: {
  view: DragView;
  actors: ActorView[];
  characters: Character[];
  chooser: { actorId: string; choices: string[] } | null;
}) {
  const { t } = useI18n();
  const byId = new Map(actors.map((a) => [a.id, a]));
  const name = (id: string | null) => {
    const c = id ? characters.find((x) => x.id === id) : null;
    return c ? c.name.trim() || t("common.unnamed") : "";
  };

  if (!view) {
    if (!chooser) return null;
    const me = byId.get(chooser.actorId);
    return (
      <>
        {me && <Ring a={me} tone="self" />}
        {chooser.choices.map((id) => {
          const a = byId.get(id);
          return a ? <Ring key={id} a={a} tone="pick" pulse /> : null;
        })}
      </>
    );
  }

  const me = byId.get(view.actorId);
  if (!me) return null;
  const target = view.targetId ? byId.get(view.targetId) : null;
  const reachable = !!target && view.route !== null;
  const from = { x: me.x, y: me.y - 12 };
  const to = target ? { x: target.x, y: target.y - 12 } : view.point;
  const label = target ? (reachable ? t("talk.drag.talk", { other: name(target.id) }) : t("talk.drag.noRoute", { other: name(target.id) })) : t("talk.drag.empty");
  // Label above the pointer (touch: well above the finger), kept inside the stage.
  const lift = view.kind === "touch" ? 46 : 18;
  const lx = Math.min(STAGE.width - 40, Math.max(40, view.point.x));
  const ly = Math.max(8, view.point.y - lift);

  return (
    <>
      <Ring a={me} tone="self" />
      {target && <Ring a={target} tone={reachable ? "ok" : "bad"} />}
      <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} preserveAspectRatio="none" aria-hidden>
        {/* Walking route (feet level) when the target can be reached. */}
        {reachable && view.route && view.route.length > 0 && (
          <polyline
            points={[{ x: me.x, y: me.y }, ...view.route].map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--color-mint-deep)"
            strokeWidth={3}
            strokeDasharray="1 6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={target ? (reachable ? "var(--color-mint-deep)" : "var(--color-coral-deep)") : "var(--color-label)"}
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
          opacity={0.8}
        />
        <circle cx={view.point.x} cy={view.point.y} r={2.5} fill="white" stroke="var(--color-ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        role="status"
        className={`absolute -translate-x-1/2 -translate-y-full whitespace-nowrap px-1.5 py-0.5 font-head text-[11px] font-bold sm:text-xs ${
          target ? (reachable ? "bg-mint-hi text-ink" : "bg-peach-hi text-coral-deep") : "bg-white/90 text-ink-soft"
        }`}
        style={{ left: pct(lx, STAGE.width), top: pct(ly, STAGE.height), zIndex: 20 }}
      >
        {label}
      </span>
    </>
  );
}
