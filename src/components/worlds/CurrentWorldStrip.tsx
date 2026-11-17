"use client";

import Link from "next/link";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useActiveWorld } from "@/lib/saves/worldSaves";
import { getWorld } from "@/lib/worlds";
import { useI18n } from "@/i18n";
import { useWorldName } from "./worldNames";

/** Slim bar under the top bar on game screens: which world save you are in, and a way back to My Worlds. */
export function CurrentWorldStrip() {
  const { t } = useI18n();
  const world = useActiveWorld();
  const nameOf = useWorldName();
  if (!world) return null;
  const theme = getWorld(world.theme);
  return (
    <div className="border-b border-line bg-surface/80" data-world-strip>
      <div className="content-grid flex items-center justify-between gap-3 py-1">
        <p className="flex min-w-0 items-center gap-2 text-base">
          <span className="shrink-0 font-label text-[10px] uppercase text-rose">{t("myWorlds.inWorld")}</span>
          <span className="flex shrink-0" style={{ color: theme?.accent }}>
            <PixelIcon name={theme?.icon ?? "globe"} size={11} />
          </span>
          <span className="truncate font-head font-semibold text-ink" data-world-name>
            {nameOf(world)}
          </span>
        </p>
        <span className="flex shrink-0 items-center gap-1">
          <Link href="/library" className="px-focus flex min-h-9 items-center gap-1 px-1 font-label text-[10px] uppercase text-label hover:bg-well">
            <PixelIcon name="book" size={10} />
            <span className="hidden sm:inline">{t("library.menu")}</span>
            <span className="sr-only sm:hidden">{t("library.menu")}</span>
          </Link>
          <Link href="/#my-worlds" className="px-focus flex min-h-9 items-center gap-1 px-1 font-label text-[10px] uppercase text-label hover:bg-well">
            <PixelIcon name="globe" size={10} />
            {t("myWorlds.switch")}
          </Link>
        </span>
      </div>
    </div>
  );
}
