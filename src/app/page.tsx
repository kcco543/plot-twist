"use client";

import { useState } from "react";
import { MyWorlds, byLastPlayed, useContinueWorld, useCreateWorld } from "@/components/worlds/MyWorlds";
import { useWorldName } from "@/components/worlds/worldNames";
import { Logo } from "@/components/Logo";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { SettingsModal } from "@/components/SettingsModal";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { Sparkle } from "@/components/ui/Deco";
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
    <div className="flex min-h-dvh flex-col bg-well">
      <main className={`relative flex ${last ? "min-h-[86svh]" : "min-h-dvh"} flex-col overflow-hidden`}>
        {/* Replaceable title art (src/assets/manifest.ts). Cropped, never stretched. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={titleArt.src} alt="" aria-hidden className="pixelated pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom" />

        <div className="gutter relative z-10 flex justify-end pt-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 0px))" }}>
          <LanguageSwitch />
        </div>

        <div className="gutter relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-10">
          <div className="relative">
            <Logo />
            <span aria-hidden className="pointer-events-none absolute inset-0 text-white">
              <Sparkle size={14} twinkle className="absolute -left-6 top-2" />
              <Sparkle size={10} twinkle delay={700} className="absolute -right-4 top-1/3 text-butter-hi" />
              <Sparkle size={12} twinkle delay={1400} className="absolute -bottom-2 left-1/4 text-pink-hi" />
            </span>
          </div>
          <p className="mt-8 max-w-md text-center font-head text-lg font-semibold leading-snug text-ink sm:mt-10 sm:text-2xl">
            {t("title.tagline1")}
            <br />
            <span className="text-rose">{t("title.tagline2")}</span>
          </p>

          <nav
            aria-label={t("title.menu")}
            className="px-frame px-shadow mt-10 flex w-full max-w-xs flex-col items-stretch gap-4 p-2 sm:mt-12"
            style={{ "--frame": "var(--frame-panel)" } as React.CSSProperties}
          >
            {last ? (
              <>
                <PixelButton variant="primary" size="lg" icon="play" onClick={() => continueWorld(last.id)}>
                  <span className="block max-w-[14rem] truncate">{t("myWorlds.continueLast", { name: nameOf(last) })}</span>
                </PixelButton>
                <PixelButton variant="magic" size="md" icon="plus" onClick={create}>
                  {t("myWorlds.create")}
                </PixelButton>
                <PixelLink href="#my-worlds" variant="calm" size="md" icon="down">
                  {t("myWorlds.jump")}
                </PixelLink>
              </>
            ) : (
              <PixelButton variant="primary" size="lg" icon="play" onClick={create}>
                {t("title.start")}
              </PixelButton>
            )}
            <PixelButton size="md" variant="secondary" icon="gear" onClick={() => setSettingsOpen(true)}>
              {t("title.settings")}
            </PixelButton>
          </nav>

          <p className="mt-8 animate-blink bg-surface/80 px-2 py-1 font-label text-xs uppercase text-label" aria-hidden>
            ▶ {t("title.pressStart")}
          </p>
        </div>
      </main>

      {index.worlds.length > 0 && (
        <section id="my-worlds" aria-label={t("myWorlds.heading")} className="gutter relative mx-auto w-full max-w-6xl scroll-mt-4 py-10 sm:py-14">
          <MyWorlds />
        </section>
      )}

      <footer
        className="gutter relative z-10 mt-auto flex items-center justify-between bg-surface/70 pt-3 font-label text-[10px] uppercase text-ink-soft"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
      >
        <span>{t("title.version")}</span>
        <span>© 2026 PLOT TWIST!</span>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
