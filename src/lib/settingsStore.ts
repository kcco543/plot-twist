"use client";

import { createPersistentStore } from "./persistentStore";
import type { Settings, TextSpeed } from "./types";

export const defaultSettings: Settings = { crt: false, reduceMotion: false, textSpeed: "normal", eventFrequency: "normal", aiStory: true };

const store = createPersistentStore<Settings>("plot-twist:settings:v1", defaultSettings);

export const useSettings = store.useStore;
export const updateSettings = (patch: Partial<Settings>) => store.set((s) => ({ ...s, ...patch }));

/** Dialogue speed: milliseconds per visible character (grapheme). 0 = show the whole line at once. */
export const TEXT_SPEED_MS: Record<TextSpeed, number> = { slow: 80, normal: 40, fast: 15, instant: 0 };
