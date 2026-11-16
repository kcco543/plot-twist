"use client";

import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { DragOverlay, useDragView, type DragView } from "./CharacterDrag";
import type { StageSim } from "@/lib/stage/sim";
import { useStageSnapshot } from "@/lib/stage/useStage";
import type { Character } from "@/lib/types";
import { EmotionEffects } from "./EmotionEffects";
import { anchorOf, SceneLabels, SceneSprites } from "./SceneSprites";
import { SpeechBubble } from "./SpeechBubble";
import { useStageSize } from "./PixelStage";
import { roomSize, type NavMask } from "@/lib/stage/room";

/**
 * The parts of the stage that move every frame subscribe to the simulation
 * here, so only they re-render while characters walk (not the whole screen).
 */
export function StageActors({
  stage,
  characters,
  selectedId,
  onSelect,
  onPressStart,
  reducedMotion,
}: {
  stage: StageSim;
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPressStart?: (id: string, e: ReactPointerEvent<HTMLElement>) => void;
  reducedMotion: boolean;
}) {
  const snap = useStageSnapshot(stage);
  return (
    <>
      <SceneSprites characters={characters} actors={snap.actors} selectedId={selectedId} onSelect={onSelect} onPressStart={onPressStart} />
      <EmotionEffects actors={snap.actors} reducedMotion={reducedMotion} />
    </>
  );
}

type BubbleProps = Omit<ComponentProps<typeof SpeechBubble>, "anchor">;

export function StageOverlay({
  stage,
  characters,
  selectedId,
  speakerId,
  bubble,
  drag,
  chooser = null,
  showNav = false,
}: {
  stage: StageSim;
  characters: Character[];
  selectedId: string | null;
  speakerId: string | null;
  bubble: BubbleProps;
  /** Drag-to-talk preview (and tap-to-target rings). */
  drag?: { subscribe: (l: () => void) => () => void; get: () => DragView };
  chooser?: { actorId: string; choices: string[] } | null;
  /** Developer view: the walkable floor, obstacles and object anchors the planner uses. */
  showNav?: boolean;
}) {
  const snap = useStageSnapshot(stage);
  const size = useStageSize();
  const anchor = anchorOf(speakerId ? snap.actors.find((a) => a.id === speakerId) : null, size);
  return (
    <>
      {showNav && <NavLayer stage={stage} />}
      {drag && <DragLayer store={drag} actors={snap.actors} characters={characters} chooser={chooser} objects={stage.objects} />}
      <SceneLabels characters={characters} actors={snap.actors} selectedId={selectedId} speakingId={anchor ? speakerId : null} />
      {anchor && <SpeechBubble {...bubble} anchor={anchor} />}
    </>
  );
}

function DragLayer({ store, ...rest }: { store: { subscribe: (l: () => void) => () => void; get: () => DragView } } & Omit<ComponentProps<typeof DragOverlay>, "view">) {
  const view = useDragView(store);
  return <DragOverlay view={view} {...rest} />;
}

/** The explicit navigation layer (test panel): floor in green, obstacles in red, objects dashed, anchors as dots. */
function NavLayer({ stage }: { stage: StageSim }) {
  const r = stage.room;
  const { width, height } = roomSize(r);
  const pctX = (x: number) => `${(x / width) * 100}%`;
  const pctY = (y: number) => `${(y / height) * 100}%`;
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ left: pctX(x0), top: pctY(y0), width: pctX(x1 - x0), height: pctY(y1 - y0) });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-nav-layer>
      {r.mask ? (
        <MaskCells mask={r.mask} width={width} height={height} />
      ) : (
        <span className="absolute bg-mint/25 outline outline-1 outline-mint-deep" style={box(r.walk.x0, r.walk.y0, r.walk.x1, r.walk.y1)} />
      )}
      {r.obstacles.map((o) => (
        <span key={o.id} className="absolute bg-coral-deep/30 outline outline-1 outline-coral-deep" style={box(o.x0, o.y0, o.x1, o.y1)} />
      ))}
      {stage.objects.map((o) => (
        <span key={o.id}>
          <span className="absolute outline-dashed outline-1 outline-label" style={box(o.bounds.x0, o.bounds.y0, o.bounds.x1, o.bounds.y1)} />
          {o.anchors.map((a, i) => (
            <span key={i} className="absolute size-[1.2%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-label" style={{ left: pctX(a.x), top: pctY(a.y) }} />
          ))}
        </span>
      ))}
    </div>
  );
}

/** A free-form floor (generated maps), drawn as one SVG path of its cells. */
function MaskCells({ mask, width, height }: { mask: NavMask; width: number; height: number }) {
  let d = "";
  for (let r = 0; r < mask.rows; r++)
    for (let c = 0; c < mask.cols; c++) if (mask.cells[r * mask.cols + c]) d += `M${c * mask.cw} ${r * mask.ch}h${mask.cw}v${mask.ch}h${-mask.cw}z`;
  return (
    <svg className="absolute inset-0 size-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={d} className="fill-mint/30" />
    </svg>
  );
}
