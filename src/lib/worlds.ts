import type { WorldId } from "./types";
import type { IconName } from "@/components/ui/PixelIcon";

/**
 * World data that is NOT text. Names, blurbs and tags are translated:
 * see worlds.list.<id> in src/i18n/locales/*.json.
 */
export type World = {
  id: WorldId;
  icon: IconName;
  /** Text-safe accent color on cream (CSS var). */
  accent: string;
  /** 9-slice frame for this world's rim. */
  frame: `world-${WorldId}`;
  /** The hero world: fully illustrated art, shown first-class in the UI. */
  featured?: boolean;
};

export const WORLDS: World[] = [
  { id: "western-fantasy", icon: "sword", accent: "var(--color-world-western-fantasy)", frame: "world-western-fantasy" },
  { id: "modern", icon: "phone", accent: "var(--color-world-modern)", frame: "world-modern" },
  { id: "ancient-china", icon: "lantern", accent: "var(--color-world-ancient-china)", frame: "world-ancient-china" },
  { id: "otherworld", icon: "eye", accent: "var(--color-world-otherworld)", frame: "world-otherworld", featured: true },
];

export const getWorld = (id: WorldId | null) => WORLDS.find((w) => w.id === id) ?? null;
