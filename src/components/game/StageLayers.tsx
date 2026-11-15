"use client";

import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { DragOverlay, useDragView, type DragView } from "./CharacterDrag";
import type { StageSim } from "@/lib/stage/sim";
import { useStageSnapshot } from "@/lib/stage/useStage";
import type { Character } from "@/lib/types";
import { EmotionEffects } from "./EmotionEffects";
import { anchorOf, SceneLabels, SceneSprites } from "./SceneSprites";
import { SpeechBubble } from "./SpeechBubble";

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
}: {
  stage: StageSim;
  characters: Character[];
  selectedId: string | null;
  speakerId: string | null;
  bubble: BubbleProps;
  /** Drag-to-talk preview (and tap-to-target rings). */
  drag?: { subscribe: (l: () => void) => () => void; get: () => DragView };
  chooser?: { actorId: string; choices: string[] } | null;
}) {
  const snap = useStageSnapshot(stage);
  const anchor = anchorOf(speakerId ? snap.actors.find((a) => a.id === speakerId) : null);
  return (
    <>
      {drag && <DragLayer store={drag} actors={snap.actors} characters={characters} chooser={chooser} />}
      <SceneLabels characters={characters} actors={snap.actors} selectedId={selectedId} speakingId={anchor ? speakerId : null} />
      {anchor && <SpeechBubble {...bubble} anchor={anchor} />}
    </>
  );
}

function DragLayer({ store, ...rest }: { store: { subscribe: (l: () => void) => () => void; get: () => DragView } } & Omit<ComponentProps<typeof DragOverlay>, "view">) {
  const view = useDragView(store);
  return <DragOverlay view={view} {...rest} />;
}
