"use client";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ArtImage } from "@/components/ui/ArtImage";
import { LoadingState } from "@/components/ui/LoadingDots";
import { Panel } from "@/components/ui/Panel";
import { PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { worldArt } from "@/assets/manifest";
import { artFor } from "@/lib/character/art";
import { nextStepFor, useSave } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import { getWorld } from "@/lib/worlds";
import { useI18n } from "@/i18n";

export default function LoadGamePage() {
  const { t, locale } = useI18n();
  const hydrated = useHydrated();
  const save = useSave();
  const world = getWorld(save.worldId);
  const hasSave = Boolean(save.updatedAt);
  const count = save.characters.length;

  return (
    <main className="gutter mx-auto w-full max-w-3xl flex-1 py-8 sm:py-10">
      <ScreenHeader kicker={t("load.kicker")} title={t("load.heading")}>
        {t("load.intro")}
      </ScreenHeader>

      {!hydrated ? (
        <LoadingState label={t("common.loadingSave")} />
      ) : !hasSave ? (
        <Panel>
          <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
            <PixelIcon name="load" size={40} className="text-ink-mute" />
            <h2 className="font-head text-2xl font-bold">{t("load.emptyTitle")}</h2>
            <p className="text-lg text-ink-soft">{t("load.emptyBody")}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <PixelLink href="/" variant="ghost" icon="left">
                {t("common.title")}
              </PixelLink>
              <PixelLink href="/worlds" variant="primary" icon="play">
                {t("load.newGame")}
              </PixelLink>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel title={t("load.slot")} frame={world ? world.frame : "panel"}>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="w-full shrink-0 sm:w-60">
              {world ? (
                <ArtImage art={worldArt[world.id]} alt={t("worlds.illustration", { name: t(`worlds.list.${world.id}.name` as const) })} tagLabel={t("common.placeholder")} className="w-full border-2 border-outline/40" />
              ) : (
                <div className="px-checker flex aspect-[5/3] items-center justify-center border-2 border-outline/40 font-label text-xs uppercase text-ink-soft">{t("load.noWorld")}</div>
              )}
              {count > 0 && (
                <div className="mt-2 flex gap-1">
                  {save.characters.slice(0, 6).map((c) => (
                    <ArtImage key={c.id} art={artFor(c).sprite} alt={c.name} showTag={false} className="w-8" />
                  ))}
                </div>
              )}
            </div>
            <dl className="grid flex-1 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2 text-lg">
              <dt className="font-label text-[10px] uppercase text-rose">{t("load.world")}</dt>
              <dd style={{ color: world?.accent }}>{world ? t(`worlds.list.${world.id}.name` as const) : t("load.notChosen")}</dd>
              <dt className="font-label text-[10px] uppercase text-rose">{t("load.cast")}</dt>
              <dd>{count === 1 ? t("load.character") : t("load.characters", { count })}</dd>
              <dt className="font-label text-[10px] uppercase text-rose">{t("load.setting")}</dt>
              <dd>{t(`environments.${save.environment.type}.name` as const)}</dd>
              <dt className="font-label text-[10px] uppercase text-rose">{t("load.saved")}</dt>
              <dd className="tabular-nums">{new Date(save.updatedAt!).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</dd>
            </dl>
          </div>
          <div className="mt-4 flex flex-wrap justify-between gap-3 border-t-[3px] border-dashed border-line pt-4">
            <PixelLink href="/" variant="ghost" icon="left">
              {t("common.title")}
            </PixelLink>
            <PixelLink href={nextStepFor(save)} variant="primary" icon="play">
              {t("common.continue")}
            </PixelLink>
          </div>
        </Panel>
      )}
    </main>
  );
}
