"use client";

import { useStageSize } from "@/components/game/PixelStage";
import { PixelIcon } from "@/components/ui/PixelIcon";
import type { ObjectState } from "@/lib/explore/interact";
import type { WorldObject } from "@/lib/stage/objects";

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/**
 * What the picture can't show by itself, drawn over it in world coordinates
 * (so it moves and zooms with the camera):
 *   - an open door: a dark doorway with the door panel swung aside
 *   - an open chest: a small glint
 *   - a locked door / chest: a tiny lock
 *   - exit markers the game added (the way back to another area), with their destination
 */
export function WorldMarks({ objects, stateOf, labelOf, reducedMotion }: { objects: WorldObject[]; stateOf: (o: WorldObject) => ObjectState; labelOf: (o: WorldObject) => string | null; reducedMotion: boolean }) {
  const size = useStageSize();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-world-marks>
      {objects.map((o) => {
        const s = stateOf(o);
        const b = o.bounds;
        const box = { left: pct(b.x0, size.width), top: pct(b.y0, size.height), width: pct(b.x1 - b.x0, size.width), height: pct(b.y1 - b.y0, size.height) };
        if (o.marker) {
          const label = labelOf(o);
          return (
            <span key={o.id} className="absolute flex flex-col items-center" style={{ left: pct((b.x0 + b.x1) / 2, size.width), top: pct(b.y0, size.height), transform: "translate(-50%, -100%)" }} data-exit-marker={o.id}>
              {label && <span className="mb-0.5 whitespace-nowrap bg-plum px-1 py-[1px] font-label text-[9px] uppercase text-white shadow-[0_2px_0_rgb(0_0_0/0.25)]">{label}</span>}
              <svg width="18" height="20" viewBox="0 0 9 10" shapeRendering="crispEdges">
                <rect x="4" y="3" width="1" height="7" fill="var(--color-ink)" />
                <rect x="0" y="0" width="8" height="4" fill="var(--color-butter)" />
                <rect x="0" y="0" width="8" height="1" fill="var(--color-ink)" />
                <rect x="0" y="3" width="8" height="1" fill="var(--color-ink)" />
                <rect x="0" y="0" width="1" height="4" fill="var(--color-ink)" />
                <rect x="8" y="1" width="1" height="2" fill="var(--color-ink)" />
                <rect x="2" y="2" width="4" height="1" fill="var(--color-label)" />
              </svg>
            </span>
          );
        }
        if (o.type === "door") {
          return (
            <span key={o.id} className="absolute" style={box} data-door-state={s.open ? "open" : s.locked ? "locked" : "closed"} data-door={o.id}>
              {s.open && (
                <>
                  <span className="absolute inset-[10%_14%_0_14%] bg-[#120d18]/75 shadow-[inset_0_6px_0_rgb(0_0_0/0.35)]" />
                  <span
                    className="absolute inset-y-[6%] left-[8%] w-[16%] bg-[#6b4a35] shadow-[inset_-2px_0_0_rgb(0_0_0/0.35),inset_2px_0_0_rgb(255_255_255/0.15)]"
                    style={{ transformOrigin: "0 50%", animation: reducedMotion ? undefined : "door-swing 380ms steps(4, end) both" }}
                  />
                </>
              )}
              {!s.open && s.locked && (
                <span className="absolute -top-1 left-1/2 grid size-4 -translate-x-1/2 place-items-center bg-white/90 text-coral-deep shadow-[0_0_0_1px_var(--color-coral-deep)]">
                  <PixelIcon name="lock" size={8} />
                </span>
              )}
            </span>
          );
        }
        if (o.type === "chest" && (s.open || s.locked)) {
          return (
            <span key={o.id} className="absolute" style={box} data-chest-state={s.open ? "open" : "locked"}>
              <span className={`absolute -top-1 left-1/2 grid size-4 -translate-x-1/2 place-items-center bg-white/90 ${s.open ? "text-label" : "text-coral-deep"}`}>
                <PixelIcon name={s.open ? "sparkle" : "lock"} size={8} />
              </span>
            </span>
          );
        }
        return null;
      })}
    </div>
  );
}
