"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { MIN_REGION, growRegion, moveRegion, oppositeCorner, regionFromPoints, type Corner, type Region } from "@/lib/mapSelection";

/**
 * REGION SELECTION — the "Edit region" overlay on the map preview.
 * --------------------------------------------------------------------------
 * Sits on top of MapStage's image (same box, same aspect ratio). Drag on
 * empty map to draw a rectangle, drag inside it to move it, drag a corner
 * handle to resize. Everything outside the selection is dimmed. Works with
 * mouse, pen and touch (touch-action: none only while this overlay is on, so
 * the page still scrolls normally outside edit mode). Keyboard: arrows move
 * the box, Shift+arrows resize it, Delete clears it.
 * The selection is reported in fractions of the map (see mapSelection.ts).
 */
type Drag = { kind: "draw"; ax: number; ay: number } | { kind: "move"; px: number; py: number; start: Region };

export function RegionSelector({
  region,
  onChange,
  disabled,
  label,
  children,
}: {
  region: Region | null;
  onChange: (r: Region | null) => void;
  disabled?: boolean;
  /** Accessible name for the selection box. */
  label: string;
  /** Shown inside the selection (e.g. the "repainting" status). */
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const point = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const start = (e: PointerEvent, d: Drag) => {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    box.current?.setPointerCapture(e.pointerId);
    drag.current = d;
  };

  const onDown = (e: PointerEvent) => {
    const p = point(e);
    start(e, { kind: "draw", ax: p.x, ay: p.y });
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.kind === "draw") onChange(regionFromPoints(d.ax, d.ay, p.x, p.y));
    else onChange(moveRegion(d.start, p.x - d.px, p.y - d.py));
  };

  const onUp = (e: PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    if (box.current?.hasPointerCapture(e.pointerId)) box.current.releasePointerCapture(e.pointerId);
    // A tap or a tiny scribble isn't a selection.
    if (region && (region.w < MIN_REGION || region.h < MIN_REGION)) onChange(null);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!region || disabled) return;
    const step = 0.01;
    const dir: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (dir[e.key]) {
      e.preventDefault();
      const [dx, dy] = dir[e.key];
      onChange(e.shiftKey ? growRegion(region, dx, dy) : moveRegion(region, dx, dy));
    } else if (e.key === "Delete" || e.key === "Backspace" || e.key === "Escape") {
      e.preventDefault();
      onChange(null);
    }
  };

  const pct = (v: number) => `${v * 100}%`;
  const corners: Corner[] = ["nw", "ne", "sw", "se"];

  return (
    <div
      ref={box}
      className={`absolute inset-0 select-none ${disabled ? "cursor-default" : "cursor-crosshair"}`}
      style={{ touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      data-region-selector
    >
      {!region && <div className="pointer-events-none absolute inset-0 bg-[rgb(58_46_92/0.18)]" />}
      {region && (
        <div
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            const p = point(e);
            start(e, { kind: "move", px: p.x, py: p.y, start: region });
          }}
          className={`px-focus absolute ${disabled ? "" : "cursor-move"}`}
          style={{
            left: pct(region.x),
            top: pct(region.y),
            width: pct(region.w),
            height: pct(region.h),
            // Dim everything outside the selection; marching dashed border inside.
            boxShadow: "0 0 0 9999px rgb(58 46 92 / 0.42), inset 0 0 0 2px #fffaf0, inset 0 0 0 4px rgb(91 74 134 / 0.85)",
          }}
        >
          <span className="region-ants pointer-events-none absolute inset-[2px]" aria-hidden />
          {!disabled &&
            corners.map((c) => (
              <span
                key={c}
                aria-hidden
                onPointerDown={(e) => {
                  const o = oppositeCorner(region, c);
                  start(e, { kind: "draw", ax: o.x, ay: o.y });
                }}
                className={`absolute grid size-8 place-items-center sm:size-6 ${c[0] === "n" ? "-top-4 sm:-top-3" : "-bottom-4 sm:-bottom-3"} ${c[1] === "w" ? "-left-4 sm:-left-3" : "-right-4 sm:-right-3"}`}
                style={{ cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize" }}
              >
                <span className="block size-3 bg-butter shadow-[0_0_0_2px_#5b4a86]" />
              </span>
            ))}
          {children}
        </div>
      )}
    </div>
  );
}
