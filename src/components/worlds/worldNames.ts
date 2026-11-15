"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { listMaps } from "@/lib/mapLibrary";
import type { WorldSave } from "@/lib/saves/worldSaves";

/** A world's name as shown: the player's own, or "Otherworld 2" / "New World 3" until they name it. */
export function useWorldName() {
  const { t, tx } = useI18n();
  return useCallback(
    (w: Pick<WorldSave, "name" | "theme" | "number">) =>
      w.name || (w.theme ? t("myWorlds.autoName", { theme: tx(`worlds.list.${w.theme}.name`), n: w.number }) : t("myWorlds.newWorldName", { n: w.number })),
    [t, tx],
  );
}

/** Object URLs for the generated maps the cards show, keyed by map id. */
export function useMapThumbnails(mapIds: (string | null)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const wanted = [...new Set(mapIds.filter((id): id is string => Boolean(id)))].sort().join(",");
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    const made: string[] = [];
    const ids = new Set(wanted.split(","));
    listMaps()
      .then((maps) => {
        if (!alive) return;
        const next: Record<string, string> = {};
        for (const m of maps) {
          if (!ids.has(m.id)) continue;
          const url = URL.createObjectURL(m.blob);
          made.push(url);
          next[m.id] = url;
        }
        setUrls(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [wanted]);
  return urls;
}
