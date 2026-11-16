"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { bubbleMaxWidth, placeBubble, type BubblePlacement } from "@/lib/dialogue/bubble";
import { splitTrailingSpace } from "@/lib/dialogue/typewriter";
import type { Typewriter } from "@/lib/useTypewriter";
import { useI18n } from "@/i18n";
import { useStageView } from "./PixelStage";

/** Line height of bubble text, in em. The text window is exactly two lines tall. */
const LINE = 1.4;

/**
 * Pixel speech bubble drawn in the stage's unscaled overlay, anchored to the
 * speaking character's head. It shares the play screen's single typewriter
 * (no second timer) and the same "advance" action as the dialogue panel.
 *
 * - Two visible lines max. Longer lines scroll inside the bubble (wheel or
 *   touch) and auto-follow the typing until the player scrolls up.
 * - Click / tap / Enter / Space: finish typing, then next line.
 * - Pointer, wheel and key events stop here, so they never reach the game.
 */
export function SpeechBubble({
  lineId,
  speaker,
  anchor,
  typer,
  more,
  onAdvance,
}: {
  /** Changes with every new line (resets scrolling + pop-in). */
  lineId: string;
  speaker: string;
  /** Speaker's head as fractions of the stage. */
  anchor: { x: number; y: number };
  typer: Typewriter;
  /** Another line follows this one. */
  more: boolean;
  onAdvance: () => void;
}) {
  const { t } = useI18n();
  const layer = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  // The part of the stage on screen (phones pan a camera across a wider stage).
  const view = useStageView();
  const offsetX = view?.offsetX ?? 0;
  const viewW = view?.viewW ?? stage?.w ?? 0;
  // The camera can also pan vertically on big maps: keep the bubble inside the visible part.
  const offsetY = view?.offsetY ?? 0;
  const viewH = view?.viewH ?? stage?.h ?? 0;
  const [place, setPlace] = useState<BubblePlacement | null>(null);
  const [edges, setEdges] = useState({ up: false, down: false });

  // Scroll bookkeeping lives in refs: it changes every frame and must not re-render.
  const follow = useRef(true);
  const lastSet = useRef(-1);
  const gesture = useRef<{ x: number; y: number; scroll: number } | null>(null);

  // ---- stage size (the overlay scales with the stage, so this tracks resizes / camera fit)
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- position: measured after layout, clamped inside the stage
  useLayoutEffect(() => {
    const b = body.current;
    if (!b || !stage) return;
    // Place inside the visible part of the stage, then convert back to stage coordinates.
    const inView = placeBubble({ stageW: viewW, stageH: viewH, anchorX: anchor.x * stage.w - offsetX, anchorY: anchor.y * stage.h - offsetY, width: b.offsetWidth, height: b.offsetHeight });
    const next = { ...inView, left: inView.left + offsetX, top: inView.top + offsetY };
    setPlace((p) => (p && p.left === next.left && p.top === next.top && p.tailX === next.tailX && p.flipped === next.flipped ? p : next));
  }, [stage, viewW, viewH, offsetX, offsetY, anchor.x, anchor.y, lineId, typer.shown, typer.rest, speaker]);

  // ---- scrolling
  /** Bottom (px, inside the scroller) of the text revealed so far. */
  const revealedBottom = useCallback(() => {
    const s = scroller.current;
    if (!s) return 0;
    const c = caret.current;
    if (!c) return s.scrollHeight;
    const lh = parseFloat(getComputedStyle(s).lineHeight) || 20;
    return Math.min(s.scrollHeight, (Math.floor((c.offsetTop + c.offsetHeight / 2) / lh) + 1) * lh);
  }, []);

  const updateEdges = useCallback(() => {
    const s = scroller.current;
    if (!s) return;
    const bottom = revealedBottom();
    const up = s.scrollTop > 1;
    const down = s.scrollTop + s.clientHeight < bottom - 1;
    setEdges((e) => (e.up === up && e.down === down ? e : { up, down }));
  }, [revealedBottom]);

  const setScroll = (top: number) => {
    const s = scroller.current;
    if (!s) return;
    lastSet.current = Math.max(0, Math.round(top));
    s.scrollTop = lastSet.current;
  };

  // New line: back to the top, following again.
  useLayoutEffect(() => {
    follow.current = true;
    setScroll(0);
  }, [lineId]);

  // While typing, keep the newest text in view (unless the player scrolled up).
  useLayoutEffect(() => {
    const s = scroller.current;
    if (!s) return;
    if (follow.current) setScroll(revealedBottom() - s.clientHeight);
    updateEdges();
  }, [typer.shown, typer.done, revealedBottom, updateEdges, stage]);

  const onScroll = () => {
    const s = scroller.current;
    if (!s) return;
    if (Math.abs(s.scrollTop - lastSet.current) < 1) return updateEdges();
    // Don't let the player scroll into the not-yet-typed (invisible) text.
    const maxTop = Math.max(0, revealedBottom() - s.clientHeight);
    if (s.scrollTop > maxTop + 1) setScroll(maxTop);
    follow.current = s.scrollTop >= maxTop - 2;
    updateEdges();
  };

  // Wheel: native, non-passive so pinch/ctrl-zoom over the bubble can be blocked.
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      if (e.ctrlKey) e.preventDefault();
    };
    s.addEventListener("wheel", onWheel, { passive: false });
    return () => s.removeEventListener("wheel", onWheel);
  }, []);

  // ---- input
  const activate = () => onAdvance();

  const label = !typer.done ? t("play.bubble.finish", { name: speaker }) : more ? t("play.bubble.next", { name: speaker }) : t("play.bubble.said", { name: speaker });

  const [head, space] = splitTrailingSpace(typer.shown);
  const lineStep = () => (scroller.current ? parseFloat(getComputedStyle(scroller.current).lineHeight) || 20 : 20);

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0" data-speech-layer>
      <div
        key={lineId}
        ref={body}
        role="button"
        tabIndex={0}
        aria-label={label}
        data-speech-bubble
        className="bubble pointer-events-auto absolute animate-pop cursor-pointer select-none outline-none"
        style={
          {
            left: place?.left ?? 0,
            top: place?.top ?? 0,
            maxWidth: viewW ? bubbleMaxWidth(viewW) : 250,
            visibility: place ? "visible" : "hidden",
            touchAction: "manipulation",
          } as CSSProperties
        }
        onPointerDown={(e) => {
          e.stopPropagation();
          gesture.current = { x: e.clientX, y: e.clientY, scroll: scroller.current?.scrollTop ?? 0 };
        }}
        onClick={(e) => {
          e.stopPropagation();
          const g = gesture.current;
          gesture.current = null;
          // A drag / touch-scroll is not a tap.
          if (g && (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8 || Math.abs((scroller.current?.scrollTop ?? 0) - g.scroll) > 2)) return;
          activate();
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          const s = scroller.current;
          const keys: Record<string, () => void> = {
            Enter: activate,
            " ": activate,
            ArrowUp: () => s?.scrollBy({ top: -lineStep() }),
            ArrowDown: () => s?.scrollBy({ top: lineStep() }),
            PageUp: () => s?.scrollBy({ top: -2 * lineStep() }),
            PageDown: () => s?.scrollBy({ top: 2 * lineStep() }),
          };
          const fn = keys[e.key];
          if (!fn) return;
          // Handled here: keep it away from the game's keyboard controls.
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat && (e.key === "Enter" || e.key === " ")) return;
          fn();
        }}
      >
        <div className="bubble-body relative px-2.5 pt-1.5 pb-1.5 sm:px-3">
          <p className="mb-0.5 flex items-center gap-1 font-label text-[9px] uppercase leading-none text-rose sm:text-[10px]">
            <span className="max-w-[16ch] truncate">{speaker}</span>
          </p>
          <div
            ref={scroller}
            onScroll={onScroll}
            className="bubble-scroll relative overflow-y-auto overscroll-contain pr-3"
            style={{ height: `${2 * LINE}em`, lineHeight: LINE, touchAction: "pan-y" }}
          >
            <p aria-hidden className="whitespace-pre-wrap break-words text-ink">
              {head}
              {!typer.done && <span ref={caret} className="bubble-caret" />}
              {space}
              {typer.rest && <span className="invisible">{typer.rest}</span>}
            </p>
          </div>
          {/* Indicators (outside the text so they never change its wrapping) */}
          {edges.up && <Chevron dir="up" className="right-1.5 top-4 text-lavender-lo" />}
          {edges.down ? (
            <Chevron dir="down" className="bottom-1 right-1.5 animate-bob text-lavender-lo" />
          ) : (
            typer.done && more && <Chevron dir="down" className="bottom-1 right-1.5 animate-bob text-rose" />
          )}
        </div>
        {place && !place.flipped && (
          <svg className="bubble-tail absolute top-full" style={{ left: place.tailX - 7 }} width="14" height="8" viewBox="0 0 7 4" shapeRendering="crispEdges" aria-hidden>
            <g fill="var(--bubble-fill)">
              <rect x="1" y="0" width="5" height="1" />
              <rect x="2" y="1" width="3" height="1" />
              <rect x="3" y="2" width="1" height="1" />
            </g>
            <g fill="var(--bubble-line)">
              <rect x="0" y="0" width="1" height="1" />
              <rect x="6" y="0" width="1" height="1" />
              <rect x="1" y="1" width="1" height="1" />
              <rect x="5" y="1" width="1" height="1" />
              <rect x="2" y="2" width="1" height="1" />
              <rect x="4" y="2" width="1" height="1" />
              <rect x="3" y="3" width="1" height="1" />
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

function Chevron({ dir, className = "" }: { dir: "up" | "down"; className?: string }) {
  return (
    <svg className={`pointer-events-none absolute ${className}`} width="10" height="6" viewBox="0 0 5 3" shapeRendering="crispEdges" aria-hidden>
      <path d={dir === "down" ? "M0 0h5v1H4v1H3v1H2V2H1V1H0z" : "M2 0h1v1h1v1h1v1H0V2h1V1h1z"} fill="currentColor" />
    </svg>
  );
}
