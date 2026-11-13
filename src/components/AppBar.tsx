"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";
import { LanguageSwitch } from "./LanguageSwitch";
import { PixelButton } from "./ui/PixelButton";
import { PixelIcon } from "./ui/PixelIcon";
import { SettingsModal } from "./SettingsModal";
import { useI18n, type MessageKey } from "@/i18n";
import { useOnline } from "@/lib/useOnline";

const STEPS: { href: string; label: MessageKey }[] = [
  { href: "/worlds", label: "nav.world" },
  { href: "/studio", label: "nav.cast" },
  { href: "/builder", label: "nav.setting" },
  { href: "/play", label: "nav.play" },
];

export function AppBar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const online = useOnline();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const current = STEPS.findIndex((s) => pathname.startsWith(s.href));

  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-ink bg-plum-900" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="gutter mx-auto flex max-w-6xl items-center justify-between gap-3 py-2">
        <Link href="/" className="px-focus flex min-h-11 shrink-0 items-center" aria-label={t("nav.home")}>
          <Logo size="sm" />
        </Link>
        <nav aria-label={t("nav.steps")} className="hidden lg:block">
          <ol className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const active = i === current;
              const done = current > i;
              return (
                <li key={s.href} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className="text-plum-500" aria-hidden>
                      <PixelIcon name="right" size={8} />
                    </span>
                  )}
                  <Link
                    href={s.href}
                    aria-current={active ? "step" : undefined}
                    className={`px-focus flex min-h-11 items-center gap-1.5 px-2 font-label text-xs uppercase transition-colors ${
                      active ? "text-butter" : done ? "text-mint hover:text-cream" : "text-cream-dim hover:text-cream"
                    }`}
                  >
                    <span className={`grid size-5 place-items-center text-[10px] ${active ? "bg-butter text-ink" : done ? "bg-mint text-ink" : "bg-plum-600 text-cream"}`}>
                      {done ? <PixelIcon name="check" size={9} /> : i + 1}
                    </span>
                    {t(s.label)}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex items-center gap-2">
          {!online && (
            <span className="flex items-center gap-1 bg-coral px-1.5 py-1 font-label text-[10px] uppercase text-ink" role="status">
              <PixelIcon name="offline" size={10} />
              {t("nav.offline")}
            </span>
          )}
          <LanguageSwitch />
          <PixelButton size="sm" variant="ghost" icon="gear" onClick={() => setSettingsOpen(true)} aria-label={t("common.settings")} className="min-w-11" />
        </div>
      </div>
      {current >= 0 && (
        <div className="gutter flex items-center justify-between gap-3 border-t-[3px] border-ink bg-plum-950 py-1.5 lg:hidden">
          <span className="font-label text-[10px] uppercase text-cream-dim">{t("nav.stepOf", { n: current + 1, total: STEPS.length })}</span>
          <span className="font-head text-sm font-semibold text-butter">{t(STEPS[current].label)}</span>
          <span className="flex gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s.href} className={`block h-2 w-5 ${i === current ? "bg-butter" : i < current ? "bg-mint" : "bg-plum-600"}`} />
            ))}
          </span>
        </div>
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
