"use client";

import { createPersistentStore } from "./persistentStore";
import type { Settings, TextSpeed } from "./types";

export const defaultSettings: Settings = { crt: false, reduceMotion: false, textSpeed: "normal", eventFrequency: "normal", aiStory: true };

const store = createPersistentStore<Settings>("plot-twist:settings:v1", defaultSettings);

export const useSettings = store.useStore;
export const updateSettings = (patch: Partial<Settings>) => store.set((s) => ({ ...s, ...patch }));

/** Milliseconds per character for the dialogue typewriter. */
export const TEXT_SPEED_MS: Record<TextSpeed, number> = { slow: 55, normal: 28, fast: 12, instant: 0 };
