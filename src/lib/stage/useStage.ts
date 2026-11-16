"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Bond, Character } from "../types";
import type { RoomLayout } from "./room";
import { StageSim, type SavedSpot, type StageSnapshot } from "./sim";

/**
 * One StageSim for the play screen, driven by requestAnimationFrame.
 * Cast / room / pause / reduced-motion changes are passed in without
 * rebuilding the sim, so positions survive language switches and re-renders.
 */
export function useStageSim({
  cast,
  room,
  paused,
  reducedMotion,
  bondOf,
  savedSpots,
  roomKey,
}: {
  cast: Character[];
  room: RoomLayout;
  /**
   * Which place `room` is. A new key = a different place (everyone is placed
   * again); the same key with a new room = the same place with changed
   * collision (a door opened), and nobody moves. Missing = every new room is a new place.
   */
  roomKey?: string;
  paused: boolean;
  reducedMotion: boolean;
  bondOf: (a: string, b: string) => Bond;
  /** Saved positions for characters as they're added (the world save). */
  savedSpots?: () => Record<string, SavedSpot>;
}): StageSim {
  const ref = useRef<StageSim | null>(null);
  if (!ref.current) ref.current = new StageSim({ room, reducedMotion });
  const sim = ref.current;
  sim.bondOf = bondOf;

  const spotsRef = useRef(savedSpots);
  spotsRef.current = savedSpots;
  const lastKey = useRef<string | undefined>(roomKey);
  useEffect(() => {
    if (roomKey !== undefined && roomKey === lastKey.current) sim.patchRoom(room);
    else sim.setRoom(room, spotsRef.current?.());
    lastKey.current = roomKey;
  }, [sim, room, roomKey]);
  useEffect(() => {
    if (spotsRef.current) sim.setSavedSpots(spotsRef.current());
    sim.setCast(cast);
  }, [sim, cast]);
  useEffect(() => {
    sim.reducedMotion = reducedMotion;
  }, [sim, reducedMotion]);
  useEffect(() => sim.setPaused(paused), [sim, paused]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      sim.tick(now - last);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  return sim;
}

const EMPTY: StageSnapshot = { actors: [], paused: false, time: 0 };

export function useStageSnapshot(sim: StageSim): StageSnapshot {
  return useSyncExternalStore(sim.subscribe, sim.getSnapshot, () => EMPTY);
}

/**
 * A character's feet position rounded to `step` art px (or null), re-rendering
 * only when that rounded value changes. Used for the camera, which shouldn't
 * re-render the whole screen on every animation frame.
 */
export function useStagePoint(sim: StageSim, id: string | null, step = 1): { x: number; y: number } | null {
  const key = useSyncExternalStore(
    sim.subscribe,
    () => {
      const a = id ? sim.getSnapshot().actors.find((v) => v.id === id) : null;
      return a ? `${Math.round(a.x / step) * step},${Math.round(a.y / step) * step}` : "";
    },
    () => "",
  );
  if (!key) return null;
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

/** OS "reduce motion" or the in-game setting. */
export function useReducedMotion(setting: boolean): boolean {
  const os = useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  return setting || os;
}
