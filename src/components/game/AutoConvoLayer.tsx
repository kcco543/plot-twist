"use client";

import { useSyncExternalStore } from "react";
import type { ConversationDirector } from "@/lib/autonomy/convoDirector";
import type { AutoConvo, ConvoTurn } from "@/lib/autonomy/convo";
import type { StageSim } from "@/lib/stage/sim";
import { useStageSnapshot } from "@/lib/stage/useStage";
import { TEXT_SPEED_MS } from "@/lib/settingsStore";
import { useTypewriter } from "@/lib/useTypewriter";
import type { Character, TextSpeed } from "@/lib/types";
import { useI18n } from "@/i18n";
import { anchorOf } from "./SceneSprites";
import { useStageSize } from "./PixelStage";
import { SpeechBubble } from "./SpeechBubble";

/** Text of a committed turn in the current language. */
export function useTurnText() {
  const { t } = useI18n();
  return (turn: ConvoTurn) => (turn.tpl ? t(turn.tpl as "common.someone", turn.params ?? {}) : (turn.text ?? ""));
}

/**
 * Autonomous conversations on the stage: a small talking indicator over
 * both participants (click to inspect), and the current line as a speech
 * bubble when the player's own dialogue isn't using the bubble. The camera
 * is never moved from here.
 */
export function AutoConvoLayer({
  stage,
  director,
  characters,
  mainSpeakerId,
  textSpeed,
  onInspect,
}: {
  stage: StageSim;
  director: ConversationDirector;
  characters: Character[];
  /** Someone speaking in the player's own dialogue: that bubble wins, ours waits. */
  mainSpeakerId: string | null;
  textSpeed: TextSpeed;
  onInspect: (sessionId: string) => void;
}) {
  const sessions = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot);
  const snap = useStageSnapshot(stage);
  const size = useStageSize();
  const { t } = useI18n();
  const shown = sessions.filter((c) => c.state === "awaiting" || c.state === "active" || c.state === "ending");
  // The one line to show as a bubble (most recent session first).
  const live = shown.find((c) => c.speaker && c.turns.length) ?? null;
  const turn = live ? live.turns[live.turns.length - 1] : null;
  const turnText = useTurnText();
  const text = turn ? turnText(turn) : "";
  const lineId = live && turn ? `${live.id}:${live.turns.length}` : "none";
  const typer = useTypewriter(text, TEXT_SPEED_MS[textSpeed], { id: lineId, paused: stage.paused });
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name.trim() || t("common.unnamed");
  const bubbleAnchor = live?.speaker && live.speaker !== mainSpeakerId && !mainSpeakerId ? anchorOf(snap.actors.find((a) => a.id === live.speaker), size) : null;

  return (
    <>
      {shown.flatMap((c) =>
        c.participants.map((id) => {
          const a = snap.actors.find((x) => x.id === id);
          if (!a) return null;
          const talkingNow = c.speaker === id;
          const label = t("autoTalk.indicator", { a: nameOf(c.participants[0]), b: nameOf(c.participants[1]) });
          return (
            <button
              key={`${c.id}:${id}`}
              type="button"
              data-auto-convo-indicator={c.id}
              data-state={c.state}
              aria-label={label}
              title={label}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onInspect(c.id);
              }}
              className={`pointer-events-auto absolute flex h-4 -translate-x-1/2 items-center gap-[2px] px-1 shadow-[0_0_0_2px_var(--color-line)] ${talkingNow ? "bg-butter-hi" : "bg-surface"} ${c.writing ? "opacity-80" : ""}`}
              style={{ left: `${(a.x / size.width) * 100}%`, top: `calc(${((a.y - 32 - 6) / size.height) * 100}% - 14px)`, zIndex: 4 }}
            >
              {[0, 1, 2].map((i) => (
                <span key={i} className={`block size-[3px] bg-label ${c.writing || talkingNow ? "animate-blink" : ""}`} style={{ animationDelay: `${i * 180}ms` }} />
              ))}
            </button>
          );
        }),
      )}
      {live && turn && bubbleAnchor && (
        <SpeechBubble lineId={lineId} speaker={nameOf(turn.speaker)} anchor={bubbleAnchor} typer={typer} more={false} onAdvance={() => onInspect(live.id)} ariaLabel={t("autoTalk.inspect", { a: nameOf(live.participants[0]), b: nameOf(live.participants[1]) })} />
      )}
    </>
  );
}

export const isShownConvo = (c: AutoConvo) => c.state === "awaiting" || c.state === "active" || c.state === "ending";
