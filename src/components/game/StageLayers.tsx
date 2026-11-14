"use client";

import type { ComponentProps } from "react";
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
  reducedMotion,
}: {
  stage: StageSim;
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
}) {
  const snap = useStageSnapshot(stage);
  return (
    <>
      <SceneSprites characters={characters} actors={snap.actors} selectedId={selectedId} onSelect={onSelect} />
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
}: {
  stage: StageSim;
  characters: Character[];
  selectedId: string | null;
  speakerId: string | null;
  bubble: BubbleProps;
}) {
  const snap = useStageSnapshot(stage);
  const anchor = anchorOf(speakerId ? snap.actors.find((a) => a.id === speakerId) : null);
  return (
    <>
      <SceneLabels characters={characters} actors={snap.actors} selectedId={selectedId} speakingId={anchor ? speakerId : null} />
      {anchor && <SpeechBubble {...bubble} anchor={anchor} />}
    </>
  );
}
