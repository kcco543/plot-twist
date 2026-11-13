"use client";

import { LOCALES, useI18n } from "@/i18n";
import { buttonStyle } from "./ui/PixelButton";
import { PixelIcon } from "./ui/PixelIcon";

/**
 * EN / 中 switch. Changes only the interface language, instantly, with no reload;
 * game state and unsaved typing are untouched.
 */
export function LanguageSwitch({ full = false }: { full?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("language.label")} className="flex items-center gap-1.5">
      {!full && <PixelIcon name="globe" size={14} className="mr-0.5 hidden text-cream-dim sm:block" />}
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            role="radio"
            aria-checked={active}
            lang={l}
            onClick={() => setLocale(l)}
            className={`px-btn min-h-11 ${full ? "px-3 text-base" : "min-w-11 px-1 text-[15px]"}`}
            style={buttonStyle(active ? "accent" : "ghost")}
          >
            {full ? t(`language.${l}`) : t(`language.short.${l}`)}
          </button>
        );
      })}
    </div>
  );
}
