"use client";
/**
 * React wiring for autonomous conversations (autonomy/convoDirector.ts): one director
 * per play screen, stepped four times a second (cheap local rules; the AI is
 * only ever asked once per accepted conversation), hooked to the stage's
 * conversation locks, and stopped cleanly on scene changes and unmount.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { rngFrom } from "../stage/behavior";
import type { StageSim } from "../stage/sim";
import type { WorldObject } from "../stage/objects";
import type { Character, EnvironmentTypeId, StoryLine, StoryState, TextSpeed, WorldId } from "../types";
import type { AutoConvo } from "../autonomy/convo";
import { buildConverseRequest, sendConverseRequest } from "./ai/converse";
import { ConversationDirector, planFromReply, type DirectorDeps, type WriteResult } from "../autonomy/convoDirector";
import type { Frequency } from "../autonomy/frequency";

export const DIRECTOR_TICK_MS = 250;

export type AutoConvoDeps = {
  stage: StageSim;
  cast: Character[];
  objects: WorldObject[];
  getStory: () => StoryState;
  setStoryState: (s: StoryState) => void;
  logLines: (lines: StoryLine[]) => void;
  inPlayerTalk: (id: string) => boolean;
  talkDistance: (a: string, b: string) => number;
  writer: "ai" | "mock" | null;
  frequency: Frequency;
  /** Autonomous behavior allowed (not the demo cast, no debug scenario, no modal). */
  enabled: boolean;
  roomKey: string;
  sceneId: string;
  sceneName: string;
  worldId: string | null;
  textSpeed: TextSpeed;
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  placeDescription: string;
  recentText: () => string[];
  objectName: (id: string) => string;
  renderText: (line: StoryLine) => string;
  depart: (actorId: string, fromId: string) => void;
  /** What a character is doing right now, in plain words (sent to the writer). */
  doing: (id: string) => string;
  reasonText: (reason: string) => string;
};

export function useAutoConversations(d: AutoConvoDeps) {
  const deps = useRef(d);
  deps.current = d;

  const writeAi = useCallback(async (c: AutoConvo, signal: AbortSignal): Promise<WriteResult> => {
    const x = deps.current;
    const a = x.cast.find((ch) => ch.id === c.participants[0]);
    const b = x.cast.find((ch) => ch.id === c.participants[1]);
    if (!a || !b) return { ok: false, code: "cancelled" };
    const req = buildConverseRequest({ story: x.getStory(), convo: c, a, b, locale: x.locale, world: x.world, place: x.place, placeDescription: x.placeDescription, recentEvents: x.recentText(), doing: x.doing, reasonText: x.reasonText(c.reason) });
    const r = await sendConverseRequest(req, signal);
    if (!r.ok) return r;
    const plan = planFromReply(c, r.data.reply);
    return { ok: true, turns: plan.turns, outcome: plan.outcome, source: r.data.source };
  }, []);

  const directorDeps = useCallback(
    (): DirectorDeps => ({
      stage: deps.current.stage,
      cast: () => deps.current.cast,
      objects: () => deps.current.objects,
      getStory: () => deps.current.getStory(),
      setStory: (s) => deps.current.setStoryState(s),
      log: (lines) => deps.current.logLines(lines),
      inPlayerTalk: (id) => deps.current.inPlayerTalk(id),
      talkDistance: (a, b) => deps.current.talkDistance(a, b),
      writer: () => deps.current.writer,
      writeAi,
      frequency: () => deps.current.frequency,
      enabled: () => deps.current.enabled,
      roomKey: () => deps.current.roomKey,
      sceneId: () => deps.current.sceneId,
      sceneName: () => deps.current.sceneName,
      worldId: () => deps.current.worldId,
      textSpeed: () => deps.current.textSpeed,
      rng: (k) => rngFrom(k),
      objectName: (id) => deps.current.objectName(id),
      renderText: (l) => deps.current.renderText(l),
      depart: (a, b) => deps.current.depart(a, b),
    }),
    [writeAi],
  );

  const director = useMemo(() => new ConversationDirector(directorDeps()), [directorDeps]);

  // The stage tells us when the player's own command meets a locked character, or a lock vanished.
  useEffect(() => {
    const { stage } = d;
    stage.onLockedMove = (actorId, sessionId) => {
      director.interrupt(sessionId, "player");
      return stage.lockOf(actorId) === null;
    };
    stage.onLockLost = (sessionId, reason) => director.interrupt(sessionId, reason === "room" ? "scene_change" : reason === "cast" ? "left" : reason === "moved" ? "player" : "reset");
    return () => {
      stage.onLockedMove = null;
      stage.onLockLost = null;
    };
  }, [d.stage, director]); // eslint-disable-line react-hooks/exhaustive-deps

  // The loop (runs while the play screen is open; the director itself checks pause / enabled).
  useEffect(() => {
    const id = window.setInterval(() => director.step(), DIRECTOR_TICK_MS);
    return () => window.clearInterval(id);
  }, [director]);

  // Another place: whatever was running there stops (the lock never outlives the scene).
  const roomKey = d.roomKey;
  const lastRoom = useRef(roomKey);
  useEffect(() => {
    if (lastRoom.current !== roomKey) director.interruptAll("scene_change");
    lastRoom.current = roomKey;
  }, [roomKey, director]);

  // Leaving the play screen: end running sessions honestly (recorded as interrupted).
  useEffect(() => () => director.interruptAll("left"), [director]);

  const sessions = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot);
  return { director, sessions };
}

export type AutoConversations = ReturnType<typeof useAutoConversations>;
