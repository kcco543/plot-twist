"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emotionOf } from "@/lib/emotion/emotions";
import { savePhoto } from "@/lib/keepsakes/store";
import { addPhotoMemory, applyPhotoReaction, validatePhotoReply, type ValidatedPhoto } from "@/lib/photo/apply";
import { blobToBase64, buildPhotoRequest, sendPhotoRequest, type PhotoResult } from "@/lib/photo/request";
import type { IdleKind } from "@/lib/stage/actions";
import type { StageSim } from "@/lib/stage/sim";
import type { Character, EnvironmentTypeId, StoryLine, StoryState, WorldId } from "@/lib/types";
import type { PhotoShot } from "./PhotoPanel";

/** A photo the character just reacted to, waiting for the player's "Save as memory" / "Not now". */
export type PhotoMoment = {
  id: number;
  characterId: string;
  name: string;
  shot: PhotoShot;
  /** Object URL for the card's thumbnail (released when the moment ends). */
  url: string;
  caption: string;
  v: ValidatedPhoto;
  source: "ai" | "mock";
  played: boolean;
  state: "open" | "saving" | "saved" | "failed";
};

const IDLE_FOR: Record<string, IdleKind> = { angry: "stomp", frustrated: "sigh", sad: "sigh", anxious: "shiver", excited: "hop", happy: "hop", surprised: "look_around", confused: "look_around" };

/**
 * Photo reactions on the play page: send the confirmed photo, validate the
 * reply, then (once the Photo window has closed and the stage runs again)
 * play it the way every other reaction plays: the emotion through story
 * state + stage.syncEmotion, movement only through stage.request (the
 * validated stage actions), and the words through the dialogue queue
 * (speech bubble + typewriter). The photo is kept only if the player saves
 * the moment as a memory.
 */
export function usePhotoMoment(d: {
  stage: StageSim;
  cast: Character[];
  getStory: () => StoryState;
  setStoryState: (s: StoryState) => void;
  showLines: (lines: StoryLine[]) => void;
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  placeDescription: string;
  /** The active world save (photos are stored under it). */
  worldId: string | null;
  /** The stage is paused (a window is open): wait before playing the reaction. */
  paused: boolean;
}) {
  const deps = useRef(d);
  deps.current = d;
  const [moment, setMoment] = useState<PhotoMoment | null>(null);
  const momentRef = useRef(moment);
  momentRef.current = moment;
  const seq = useRef(0);

  const release = useCallback((m: PhotoMoment | null) => {
    if (m) URL.revokeObjectURL(m.url);
  }, []);

  /** Send the confirmed photo. On success the reaction is applied and queued to play. */
  const send = useCallback(
    async (characterId: string, shot: PhotoShot, caption: string, signal: AbortSignal): Promise<PhotoResult> => {
      const { cast, getStory, locale, world, place, placeDescription } = deps.current;
      const character = cast.find((c) => c.id === characterId);
      if (!character) return { ok: false, code: "bad_request" };
      let data: string;
      try {
        data = await blobToBase64(shot.blob);
      } catch {
        return { ok: false, code: "bad_image" };
      }
      const req = buildPhotoRequest({ story: getStory(), character, locale, world, place, placeDescription, caption, image: { data, width: shot.width, height: shot.height } });
      const r = await sendPhotoRequest(req, signal);
      if (!r.ok || signal.aborted) return r.ok ? { ok: false, code: "cancelled" } : r;
      const now = Date.now();
      const v = validatePhotoReply(r.data.reply, character, deps.current.getStory());
      if (!v.dialogue) return { ok: false, code: "invalid_output" };
      deps.current.setStoryState(applyPhotoReaction(deps.current.getStory(), v, character, now));
      const next: PhotoMoment = {
        id: ++seq.current,
        characterId,
        name: character.name.trim(),
        shot,
        url: URL.createObjectURL(shot.blob),
        caption: caption.trim(),
        v,
        source: r.data.source,
        played: false,
        state: "open",
      };
      setMoment((prev) => {
        release(prev);
        return next;
      });
      return r;
    },
    [release],
  );

  // Play the reaction once the stage runs again (the Photo window has closed).
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

  /** "Save as memory": store the photo file (this world, this character), then the memory that links it. */
  const save = useCallback(async () => {
    const m = momentRef.current;
    const { worldId, cast, getStory, setStoryState } = deps.current;
    const character = cast.find((c) => c.id === m?.characterId);
    if (!m || !worldId || !character || m.state === "saving" || m.state === "saved") return false;
    setMoment({ ...m, state: "saving" });
    try {
      const photo = await savePhoto({ worldId, characterId: m.characterId, blob: m.shot.blob, width: m.shot.width, height: m.shot.height, caption: m.caption, source: m.shot.source });
      const r = addPhotoMemory(getStory(), character, m.v, { photoId: photo.id, caption: m.caption }, m.source);
      setStoryState(r.story);
      setMoment((cur) => (cur?.id === m.id ? { ...cur, state: "saved" } : cur));
      return true;
    } catch {
      setMoment((cur) => (cur?.id === m.id ? { ...cur, state: "failed" } : cur));
      return false;
    }
  }, []);

  /** "Not now" (or done after saving): the moment ends; an unsaved photo is let go. */
  const dismiss = useCallback(() => {
    setMoment((prev) => {
      release(prev);
      return null;
    });
  }, [release]);

  useEffect(() => () => release(momentRef.current), [release]);

  return { moment, send, save, dismiss };
}
