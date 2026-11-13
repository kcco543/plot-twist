"use client";

import { useRouter } from "next/navigation";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { WorldCard } from "@/components/game/WorldCard";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { gameActions, useSave } from "@/lib/gameStore";
import { WORLDS, getWorld } from "@/lib/worlds";
import { useI18n } from "@/i18n";

export default function WorldSelectPage() {
  const { t, tx } = useI18n();
  const router = useRouter();
  const save = useSave();
  const selected = getWorld(save.worldId);

  return (
    <>
      <main className="gutter mx-auto w-full max-w-6xl flex-1 pt-8 sm:pt-10">
        <ScreenHeader kicker={t("worlds.kicker")} title={t("worlds.heading")}>
          {t("worlds.intro")}
        </ScreenHeader>
        <div role="radiogroup" aria-label={t("worlds.group")} className="grid grid-cols-1 gap-6 min-[560px]:grid-cols-2 xl:grid-cols-4">
          {WORLDS.map((w) => (
            <WorldCard key={w.id} world={w} selected={save.worldId === w.id} onSelect={() => gameActions.selectWorld(w.id)} />
          ))}
        </div>
      </main>
      <ActionBar>
        <PixelLink href="/" variant="ghost" icon="left">
          {t("common.title")}
        </PixelLink>
        <p className="order-first w-full text-center font-label text-xs uppercase text-ink-soft sm:order-none sm:w-auto" aria-live="polite">
          {selected ? (
            <>
              {t("worlds.selectedLabel")} <span style={{ color: selected.accent }}>{tx(`worlds.list.${selected.id}.name`)}</span>
            </>
          ) : (
            t("worlds.none")
          )}
        </p>
        <PixelButton variant="primary" iconRight="right" disabled={!selected} onClick={() => router.push("/studio")}>
          {t("common.continue")}
        </PixelButton>
      </ActionBar>
    </>
  );
}
