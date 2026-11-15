"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emotionOf } from "@/lib/emotion/emotions";
import { checkTransfer, freeSpotCount, giveGift, validateGiftReply, type TransferProblem, type ValidatedGift } from "@/lib/gifts/apply";
import { buildGiftRequest, sendGiftRequest, type GiftResult } from "@/lib/gifts/request";
import { recordGiving } from "@/lib/keepsakes/store";
import type { GiftKeepsake } from "@/lib/keepsakes/types";
import type { IdleKind } from "@/lib/stage/actions";
import type { StageSim } from "@/lib/stage/sim";
import type { Character, EnvironmentTypeId, StoryLine, StoryState, WorldId } from "@/lib/types";

/** A gift reaction that just happened (shown as a card under the dialogue box). */
export type GiftMoment = { id: number; characterId: string; name: string; gift: GiftKeepsake; instanceId: string; v: ValidatedGift; source: "ai" | "mock"; played: boolean };
export type GiveResult = (GiftResult & { refused?: boolean }) | { ok: false; code: "transfer"; problem: TransferProblem };

const IDLE_FOR: Record<string, IdleKind> = { angry: "stomp", frustrated: "sigh", sad: "sigh", anxious: "shiver", excited: "hop", happy: "hop", surprised: "look_around", confused: "look_around" };

/**
 * Giving a gift on the play page: check the transfer, ask the AI for the
 * character's reaction, let the game engine validate it, record the
 * world-specific gift (+ memory, emotion, bond), then — once the Gift window
 * has closed — play it like any other reaction (bubble, emotion, validated
 * stage action).
 */
export function useGiftMoment(d: {
  stage: StageSim;
  cast: Character[];
  getStory: () => StoryState;
  setStoryState: (s: StoryState) => void;
  showLines: (lines: StoryLine[]) => void;
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  placeDescription: string;
  worldId: string | null;
  spots: number;
  paused: boolean;
}) {
  const deps = useRef(d);
  deps.current = d;
  const [moment, setMoment] = useState<GiftMoment | null>(null);
  const seq = useRef(0);

  const give = useCallback(async (characterId: string, gift: GiftKeepsake, signal: AbortSignal): Promise<GiveResult> => {
    const { cast, getStory, locale, world, place, placeDescription, worldId, spots } = deps.current;
    const character = cast.find((c) => c.id === characterId);
    const problem = checkTransfer(getStory(), gift, characterId, { worldId, cast });
    if (problem || !character) return { ok: false, code: "transfer", problem: problem ?? "unknown_character" };
    const free = freeSpotCount(getStory(), spots);
    const r = await sendGiftRequest(buildGiftRequest({ story: getStory(), character, locale, world, place, placeDescription, item: gift, freeDisplaySpots: free }), signal);
    if (!r.ok) return r;
    if (signal.aborted) return { ok: false, code: "cancelled" };
    const now = Date.now();
    const story = deps.current.getStory();
    // Re-check: nothing changed while the AI was answering.
    const again = checkTransfer(story, gift, characterId, { worldId: deps.current.worldId, cast: deps.current.cast });
    if (again) return { ok: false, code: "transfer", problem: again };
    const v = validateGiftReply(r.data.reply, character, story, { freeSpots: freeSpotCount(story, deps.current.spots) });
    if (!v.dialogue) return { ok: false, code: "invalid_output" };
    const out = giveGift(story, gift, character, v, r.data.source, deps.current.cast.map((c) => c.id), now);
    deps.current.setStoryState(out.story);
    if (deps.current.worldId) await recordGiving(deps.current.worldId, gift.id, characterId).catch(() => {});
    setMoment({ id: ++seq.current, characterId, name: character.name.trim(), gift, instanceId: out.instanceId, v, source: r.data.source, played: false });
    return { ...r, refused: v.display === "refused" };
  }, []);

  useEffect(() => {
    if (!moment || moment.played || d.paused) return;
    const { stage, getStory, showLines } = deps.current;
    const { v, characterId, name, source } = moment;
    const e = emotionOf(getStory().characters[characterId]);
    stage.syncEmotion(characterId, e.emotion, e.level, e.at);
    if (v.move === "step_back") stage.request({ type: "retreat", actor: characterId, distance: 12 }, "solo", "story");
    else if (v.move !== "none") {
      const kind: IdleKind = v.move === "hop" ? "hop" : v.move === "look_around" ? "look_around" : v.move === "lean_in" ? "shift" : (IDLE_FOR[v.emotion] ?? "shift");
      stage.schedule(300, { type: "idle_reaction", actor: characterId, kind }, "solo", "story");
    }
    const speaker = { kind: "character" as const, name, id: characterId };
    const lines: StoryLine[] = [{ speaker, key: "custom", params: { text: v.dialogue }, source }];
    if (v.question) lines.push({ speaker, key: "custom", params: { text: v.question }, source });
    showLines(lines);
    setMoment({ ...moment, played: true });
  }, [moment, d.paused]);

  const dismiss = useCallback(() => setMoment(null), []);
  return { moment, give, dismiss };
}
