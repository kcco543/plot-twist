"use client";

import { useState } from "react";
import { MyWorlds, byLastPlayed, useContinueWorld, useCreateWorld } from "@/components/worlds/MyWorlds";
import { useWorldName } from "@/components/worlds/worldNames";
import { Logo } from "@/components/Logo";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { SettingsModal } from "@/components/SettingsModal";
import { SyncBadge } from "@/components/sync/SyncBadge";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { Sparkle } from "@/components/ui/Deco";
import { Panel } from "@/components/ui/Panel";
import { CastParade } from "@/components/CastParade";
import { titleArt } from "@/assets/manifest";
import { useWorldIndex } from "@/lib/saves/worldSaves";
import { useI18n } from "@/i18n";

export default function TitleScreen() {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const index = useWorldIndex();
  const nameOf = useWorldName();
  const create = useCreateWorld();
  const continueWorld = useContinueWorld();
  const last = [...index.worlds].sort(byLastPlayed)[0] ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <main className={`relative flex ${last ? "min-h-[86svh]" : "min-h-dvh"} flex-col overflow-hidden`}>
        {/* Replaceable title art (src/assets/manifest.ts). Cropped, never stretched. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={titleArt.src} alt="" aria-hidden className="pixelated pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom" />

        {/* Same content grid as every other screen: the top row's right edge lines up with the menu below. */}
        <div className="content-grid relative z-10 flex items-center justify-end gap-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 0px))" }}>
          <SyncBadge />
          <LanguageSwitch />
        </div>

        <div className="content-grid relative z-10 flex flex-1 flex-col items-center justify-center pt-8 pb-28 sm:pb-36">
          <div className="relative">
            <Logo />
            <span aria-hidden className="pointer-events-none absolute inset-0 text-white">
              <Sparkle size={14} twinkle className="absolute -left-6 top-2" />
              <Sparkle size={10} twinkle delay={700} className="absolute -right-4 top-1/3 text-butter-hi" />
              <Sparkle size={12} twinkle delay={1400} className="absolute -bottom-2 left-1/4 text-pink-hi" />
            </span>
          </div>
          <p className="mt-7 max-w-md text-center font-head text-lg font-semibold leading-snug text-ink sm:mt-9 sm:text-2xl">
            {t("title.tagline1")}
            <br />
            <span className="text-rose">{t("title.tagline2")}</span>
          </p>

          {/* The menu is a storybook window: the same Panel + nameplate tab as the in-game screens. */}
          <Panel as="div" title={t("title.menuTab")} sparkles className="mt-9 w-full max-w-[22rem] sm:mt-11">
            <nav aria-label={t("title.menu")} className="flex flex-col items-stretch gap-3">
              {last ? (
                <>
                  <PixelButton variant="primary" size="lg" icon="play" onClick={() => continueWorld(last.id)}>
                    <span className="block max-w-[14rem] truncate">{t("myWorlds.continueLast", { name: nameOf(last) })}</span>
                  </PixelButton>
                  <div className="grid grid-cols-2 gap-3">
                    <PixelButton variant="magic" size="md" icon="plus" onClick={create} className="px-1">
                      {t("common.new")}
                    </PixelButton>
                    <PixelLink href="#my-worlds" variant="calm" size="md" icon="down" className="whitespace-nowrap px-1">
                      {t("myWorlds.heading")}
                    </PixelLink>
                  </div>
                </>
              ) : (
                <PixelButton variant="primary" size="lg" icon="play" onClick={create}>
                  {t("title.start")}
                </PixelButton>
              )}
              <PixelLink href="/library" variant="accent" size="md" icon="book">
                {t("library.menu")}
              </PixelLink>
              <PixelButton size="md" variant="secondary" icon="gear" onClick={() => setSettingsOpen(true)}>
                {t("title.settings")}
              </PixelButton>
            </nav>
          </Panel>

          <p className="mt-6 animate-blink bg-surface/80 px-2 py-1 font-label text-xs uppercase text-label" aria-hidden>
            ▶ {t("title.pressStart")}
          </p>
        </div>
        <CastParade />
      </main>

      {index.worlds.length > 0 && (
        <section id="my-worlds" aria-label={t("myWorlds.heading")} className="paper-band scroll-mt-4">
          <div className="content-grid py-10 sm:py-14">
            <MyWorlds />
          </div>
        </section>
      )}

      <footer className="paper-band relative z-10 mt-auto border-t-2 border-line" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}>
        <div className="content-grid flex items-center justify-between gap-3 pt-3 font-label text-[10px] uppercase text-ink-soft">
          <span>{t("title.version")}</span>
          <span>© 2026 PLOT TWIST!</span>
        </div>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
