"use client";

import { useSyncExternalStore } from "react";

/**
 * Developer tools (the Behavior Debug Panel) are hidden from players.
 * They show in `npm run dev`, or in a production build after opening any page
 * with `?dev=1` (remembered in this browser; `?dev=0` turns it off again).
 */
const KEY = "plot-twist:dev";
const listeners = new Set<() => void>();

function read(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Apply ?dev=1 / ?dev=0 from the current URL. */
export function applyDevParam() {
  try {
    const v = new URLSearchParams(window.location.search).get("dev");
    if (v === "1") window.localStorage.setItem(KEY, "1");
    else if (v === "0") window.localStorage.removeItem(KEY);
    else return;
    listeners.forEach((l) => l());
  } catch {}
}

export function useDevMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => false,
  );
}
