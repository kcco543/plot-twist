import type { WorldId } from "./types";
import type { IconName } from "@/components/ui/PixelIcon";

export type World = {
  id: WorldId;
  name: string;
  /** One-line pitch shown on the card. */
  blurb: string;
  tags: string[];
  icon: IconName;
  /** CSS color token for the world's accent. */
  accent: string;
  /** Darker partner for text on accent backgrounds. */
  accentInk: string;
};

export const WORLDS: World[] = [
  {
    id: "western-fantasy",
    name: "Western Fantasy",
    blurb: "Castles, taverns and old prophecies that nobody reads to the end.",
    tags: ["Quests", "Magic", "Kingdoms"],
    icon: "sword",
    accent: "var(--color-world-fantasy)",
    accentInk: "var(--color-ink-950)",
  },
  {
    id: "modern",
    name: "Modern",
    blurb: "Group chats, late trains and secrets hiding in plain sight.",
    tags: ["City", "Slice of life", "Drama"],
    icon: "phone",
    accent: "var(--color-world-modern)",
    accentInk: "var(--color-ink-950)",
  },
  {
    id: "ancient-china",
    name: "Ancient China",
    blurb: "Jade halls, wandering swordsmen and debts of honor.",
    tags: ["Wuxia", "Court", "Legend"],
    icon: "lantern",
    accent: "var(--color-world-china)",
    accentInk: "var(--color-paper)",
  },
  {
    id: "otherworld",
    name: "Otherworld",
    blurb: "Floating islands and rules of physics that change their minds.",
    tags: ["Surreal", "Cosmic", "Strange"],
    icon: "eye",
    accent: "var(--color-world-other)",
    accentInk: "var(--color-ink-950)",
  },
];

export const getWorld = (id: WorldId | null) => WORLDS.find((w) => w.id === id) ?? null;
