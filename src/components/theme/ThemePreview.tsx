"use client";

import type { CSSProperties } from "react";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, buttonStyle } from "@/components/ui/PixelButton";
import { buildThemeVars, themeAttributes, BASES, type WorldUiTheme } from "@/lib/theme/themes";
import { useI18n } from "@/i18n";
import { Motif } from "./Motif";

/**
 * A small, live sample of a world skin: panel, primary and secondary
 * buttons, a tab strip, a dialogue frame and the motifs. The skin is scoped
 * to this box (CSS variables on the wrapper), so the rest of the page keeps
 * the world's saved skin until the player confirms.
 */
export function ThemePreview({ theme, label }: { theme: WorldUiTheme; label: string }) {
  const { t } = useI18n();
  const vars = buildThemeVars(theme) as CSSProperties;
  const attrs = themeAttributes(theme);
  const motifs = [...theme.decorativeMotifIds, ...BASES[theme.baseTheme].vocabulary].filter((m, i, a) => a.indexOf(m) === i).slice(0, 4);
  return (
    <figure
      {...attrs}
      aria-label={label}
      className="theme-scope relative overflow-hidden p-3 pt-9 sm:p-4 sm:pt-10"
      style={{ ...vars, background: "var(--color-bg) var(--bg-pattern) 0 0 / 96px 96px", color: "var(--color-ink)", boxShadow: "0 0 0 3px var(--color-line)" }}
      data-theme-preview={theme.baseTheme}
    >
      <Panel title={t("theme.preview.panel")}>
        <div className="flex flex-col gap-3">
          <div role="presentation" className="flex flex-wrap gap-2">
            <span className="px-btn min-h-10 px-1 text-[14px]" style={buttonStyle("accent")}>{t("theme.preview.tabA")}</span>
            <span className="px-btn min-h-10 px-1 text-[14px]" style={buttonStyle("ghost")}>{t("theme.preview.tabB")}</span>
          </div>
          <div className="px-frame relative mt-6" style={{ "--frame": "var(--frame-cream)" } as CSSProperties}>
            <span className="px-tab absolute -top-7 left-[calc(var(--u)*-4)] sm:-top-8" style={{ borderImageSource: "var(--frame-pink)" }}>
              {t("theme.preview.speaker")}
            </span>
            <p className="px-2 pt-2 pb-1 text-base leading-snug">{t("theme.preview.line")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PixelButton size="sm" variant="primary" tabIndex={-1}>
              {t("theme.preview.primary")}
            </PixelButton>
            <PixelButton size="sm" variant="secondary" tabIndex={-1}>
              {t("theme.preview.secondary")}
            </PixelButton>
            <span className="ml-auto flex items-center gap-2 text-label" aria-hidden>
              {motifs.map((m) => (
                <Motif key={m} id={m} size={14} />
              ))}
            </span>
          </div>
        </div>
      </Panel>
    </figure>
  );
}
