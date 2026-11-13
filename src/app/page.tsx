"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";
import { SettingsModal } from "@/components/SettingsModal";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { titleArt } from "@/assets/manifest";

export default function TitleScreen() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-ink-950">
      {/* Replaceable title background (see src/assets/manifest.ts) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={titleArt.src}
        alt=""
        aria-hidden
        className="pixelated pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom opacity-90"
      />
      <div className="pointer-events-none absolute inset-0 bg-ink-950/30" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
        <Logo />
        <p className="mt-8 max-w-md text-center font-display text-[10px] uppercase leading-relaxed text-paper sm:mt-10 sm:text-xs">
          You create the characters.
          <br />
          <span className="text-twist">They create the chaos.</span>
        </p>

        <nav aria-label="Main menu" className="mt-12 flex w-full max-w-xs flex-col items-stretch gap-6 sm:mt-14">
          <PixelLink href="/worlds" variant="primary" size="lg" icon="play" className="group">
            Start Game
          </PixelLink>
          <PixelLink href="/load" size="md" icon="load">
            Load Game
          </PixelLink>
          <PixelButton size="md" variant="ghost" icon="gear" onClick={() => setSettingsOpen(true)}>
            Settings
          </PixelButton>
        </nav>

        <p className="mt-12 animate-blink font-display text-[9px] uppercase text-sun" aria-hidden>
          ▶ Press start
        </p>
      </div>

      <footer className="relative z-10 flex items-center justify-between px-4 py-4 font-display text-[8px] uppercase text-paper-dim sm:px-6">
        <span>v0.1 · prototype</span>
        <span>© 2026 Plot Twist!</span>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
