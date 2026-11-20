"use client";

/**
 * THE DEMO WORLD (Quick Start)
 * --------------------------------------------------------------------------
 * "Play the demo" on the title screen opens a ready-made world straight in
 * Play Mode: Otherworld, the built-in Indoor Room and the sample cast (Mira,
 * Wren and Tobi: a quiet friend, a secret crush and an old rivalry), so a
 * first-time visitor sees personality-driven reactions without creating,
 * generating or signing in to anything.
 *
 * It is an ordinary world save, marked `demo` in its data: progress saves,
 * it shows up in My Worlds, and it can be renamed, edited, duplicated or
 * deleted like any other. "Reset demo" deletes it and makes a fresh one.
 * No other save is ever read for writing or changed.
 */
import { createWorld, enterWorld, getVisibleIndex, peekWorld, replaceWorldData } from "../saves/worldSaves";
import { deleteWorldKeepsakes } from "../keepsakes/store";
import { emptySave } from "../gameStore";
import { sampleCharacter } from "../mind/scenarios";
import { translate } from "@/i18n";
import type { Locale } from "@/i18n";
import type { SaveData } from "../types";

export const DEMO_VERSION = 1;

/** The world data a fresh demo starts from (pure: same input, same cast). */
export function demoWorldData(locale: Locale, now = Date.now()): SaveData {
  return {
    ...emptySave,
    worldId: "otherworld",
    characters: (["wren", "mira", "tobi"] as const).map((id) => sampleCharacter(id, locale)),
    environment: { description: "", type: "interior" },
    // Characters notice each other more readily here, so a visitor sees them interact on their own within a minute or two.
    observation: { frequency: "high" },
    demo: { version: DEMO_VERSION, locale },
    updatedAt: now,
  };
}

/** True for the demo world's data (read leniently: any save with the marker). */
export function isDemoData(raw: unknown): boolean {
  const d = raw && typeof raw === "object" ? (raw as { demo?: unknown }).demo : null;
  return !!d && typeof d === "object";
}

/** The demo world shown in this tab, if there is one (the most recently played, should there be several). */
export function findDemoWorldId(): string | null {
  const worlds = [...getVisibleIndex().worlds].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  return worlds.find((w) => w.theme === "otherworld" && isDemoData(peekWorld(w.id)))?.id ?? null;
}

/** Open the demo in Play Mode, creating it the first time. Returns true when the caller should navigate itself. */
export function playDemo(locale: Locale): boolean {
  const id = findDemoWorldId() ?? createWorld({ name: translate(locale, "quickstart.worldName"), data: demoWorldData(locale) }).id;
  return enterWorld(id, "/play");
}

/** Throw away the demo's progress (story, positions, photos and gifts) and start it again. Only the demo world is touched. */
export async function resetDemo(locale: Locale) {
  const id = findDemoWorldId();
  if (!id) {
    if (playDemo(locale)) window.location.assign("/play");
    return;
  }
  replaceWorldData(id, demoWorldData(locale));
  await deleteWorldKeepsakes(id).catch(() => {});
  window.location.assign("/play");
}
