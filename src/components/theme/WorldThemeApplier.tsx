"use client";

import { useLayoutEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useSave } from "@/lib/gameStore";
import { useActiveWorld } from "@/lib/saves/worldSaves";
import { applyTheme } from "@/lib/theme/apply";
import { resolveUiTheme, type WorldUiTheme } from "@/lib/theme/themes";
import { ThemeAmbient } from "./ThemeAmbient";

/** Screens that are "inside" a world. Everything else (title, My Worlds, Character Library…) wears the brand theme. */
export const WORLD_SCREENS = /^\/(studio|builder|play)(\/|$)/;

/**
 * Applies the active world's saved skin on world screens and restores the
 * PLOT TWIST! brand theme everywhere else. Entering another world reloads
 * the page (saves/worldSaves.ts), so one world's skin never leaks into another.
 */
export function WorldThemeApplier() {
  const pathname = usePathname() ?? "/";
  const save = useSave();
  const world = useActiveWorld();
  const inWorld = WORLD_SCREENS.test(pathname) && Boolean(world);
  const theme = inWorld ? resolveUiTheme(save) : null;
  // Re-apply only when the look actually changes (not on every save).
  const key = theme ? JSON.stringify({ ...theme, updatedAt: 0 }) : "";
  const stable = useMemo<WorldUiTheme | null>(() => (key ? (JSON.parse(key) as WorldUiTheme) : null), [key]);
  const worldId = world?.id ?? null;

  useLayoutEffect(() => {
    applyTheme(document.documentElement, stable, stable ? worldId : null);
  }, [stable, worldId]);

  return stable ? <ThemeAmbient theme={stable} /> : null;
}
