"use client";

/**
 * FIRST-TIME TIPS (learning by doing)
 * --------------------------------------------------------------------------
 * Play Mode shows at most ONE short tip at a time, in the dialogue dock (never
 * over the stage, never a modal). Each tip goes away as soon as the player
 * does the thing once, and "Skip tips" turns them all off.
 *
 *   talk     → start a conversation (drag, or tap a character → Talk to…)
 *   contrast → (demo world) try a pair with a different relationship
 *   object   → send someone to use something in the room
 *   watch    → leave it be: characters interact on their own
 *   makeOwn  → small card: make your own world / edit this cast / keep playing
 *
 * Remembered per browser only (localStorage). If the browser forgets, the
 * worst case is seeing the tips again; nothing else depends on it.
 */
import { useSyncExternalStore } from "react";

export const TIP_ORDER = ["talk", "contrast", "object", "watch", "makeOwn"] as const;
export type TipId = (typeof TIP_ORDER)[number];
export type TipsState = { skipped: boolean; done: TipId[] };

const KEY = "plot-twist:tips:v1";
const EMPTY: TipsState = { skipped: false, done: [] };

const isTip = (v: unknown): v is TipId => typeof v === "string" && (TIP_ORDER as readonly string[]).includes(v);

export function parseTips(raw: string | null): TipsState {
  if (!raw) return EMPTY;
  try {
    const r = JSON.parse(raw) as { skipped?: unknown; done?: unknown };
    return { skipped: r.skipped === true, done: Array.isArray(r.done) ? [...new Set(r.done.filter(isTip))] : [] };
  } catch {
    return EMPTY;
  }
}

/**
 * The tip to show now, or null. `demo` adds the contrast tip (it names the
 * demo cast's relationships); `canTalk` needs two people on stage.
 */
export function nextTip(s: TipsState, ctx: { demo: boolean; canTalk: boolean }): TipId | null {
  if (s.skipped) return null;
  for (const id of TIP_ORDER) {
    if (s.done.includes(id)) continue;
    if (id === "contrast" && !ctx.demo) continue;
    if ((id === "talk" || id === "contrast") && !ctx.canTalk) continue;
    return id;
  }
  return null;
}

// ---------------------------------------------------------------- browser store

let cache: TipsState | null = null;
const listeners = new Set<() => void>();

function read(): TipsState {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  cache = parseTips(raw);
  return cache;
}

function write(next: TipsState) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private window or storage blocked: remembered for this visit only */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const tipsActions = {
  done(id: TipId) {
    const s = read();
    if (!s.done.includes(id)) write({ ...s, done: [...s.done, id] });
  },
  skip() {
    write({ ...read(), skipped: true });
  },
  /** Settings / "Show tips again". */
  reset() {
    write(EMPTY);
  },
  get: read,
};

export function useTips(): TipsState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
