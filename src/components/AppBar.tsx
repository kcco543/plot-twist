"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";
import { PixelButton } from "./ui/PixelButton";
import { SettingsModal } from "./SettingsModal";

const STEPS = [
  { href: "/worlds", label: "World" },
  { href: "/studio", label: "Cast" },
  { href: "/builder", label: "Setting" },
  { href: "/play", label: "Play" },
];

export function AppBar() {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const current = STEPS.findIndex((s) => pathname.startsWith(s.href));

  return (
    <header className="sticky top-0 z-40 border-b-4 border-ink-950 bg-ink-800">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="px-focus shrink-0" aria-label="PLOT TWIST! title screen">
          <Logo size="sm" />
        </Link>
        <nav aria-label="Game steps" className="hidden md:block">
          <ol className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const active = i === current;
              const done = current > i;
              return (
                <li key={s.href} className="flex items-center gap-1">
                  {i > 0 && <span className="px-1 text-ink-400" aria-hidden>›</span>}
                  <Link
                    href={s.href}
                    aria-current={active ? "step" : undefined}
                    className={`px-focus px-2 py-1 font-display text-[10px] uppercase transition-colors ${
                      active ? "bg-sun text-ink-950" : done ? "text-mint hover:text-paper" : "text-paper-dim hover:text-paper"
                    }`}
                  >
                    {i + 1}.{s.label}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <PixelButton size="sm" variant="ghost" icon="gear" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <span className="hidden sm:inline">Settings</span>
        </PixelButton>
      </div>
      {current >= 0 && (
        <p className="border-t-4 border-ink-950 bg-ink-900 px-4 py-2 text-center font-display text-[9px] uppercase text-paper-dim md:hidden">
          Step {current + 1} of {STEPS.length} · <span className="text-sun">{STEPS[current].label}</span>
        </p>
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
