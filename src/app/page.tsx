"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { SettingsModal } from "@/components/SettingsModal";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { Sparkle } from "@/components/ui/Deco";
import { titleArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";

export default function TitleScreen() {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-well">
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

        <nav aria-label={t("title.menu")} className="px-frame px-shadow mt-10 flex w-full max-w-xs flex-col items-stretch gap-4 p-2 sm:mt-12" style={{ "--frame": "var(--frame-panel)" } as React.CSSProperties}>
          <PixelLink href="/worlds" variant="primary" size="lg" icon="play">
            {t("title.start")}
          </PixelLink>
          <PixelLink href="/load" variant="magic" size="md" icon="load">
            {t("title.load")}
          </PixelLink>
          <PixelButton size="md" variant="secondary" icon="gear" onClick={() => setSettingsOpen(true)}>
            {t("title.settings")}
          </PixelButton>
        </nav>

        <p className="mt-8 animate-blink bg-surface/80 px-2 py-1 font-label text-xs uppercase text-label" aria-hidden>
          ▶ {t("title.pressStart")}
        </p>
      </div>

      <footer
        className="gutter relative z-10 flex items-center justify-between bg-surface/70 pt-3 font-label text-[10px] uppercase text-ink-soft"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
      >
        <span>{t("title.version")}</span>
        <span>© 2026 PLOT TWIST!</span>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
