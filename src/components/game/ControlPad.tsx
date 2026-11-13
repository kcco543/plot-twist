"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { useI18n } from "@/i18n";

/**
 * Touch controls for phones/tablets. ◀ ▶ choose a character, A talks to them,
 * the info button opens the character sheet. (No free movement in this version.)
 */
export function ControlPad({
  name,
  mood,
  onPrev,
  onNext,
  onInteract,
  onInfo,
  disabled,
}: {
  name: string | null;
  mood: string | null;
  onPrev: () => void;
  onNext: () => void;
  onInteract: () => void;
  onInfo: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("play.controls")} className="flex items-center justify-between gap-2 border-t-[3px] border-dashed border-line pt-3 lg:hidden">
      <div className="flex min-w-0 items-center gap-1.5">
        <PixelButton size="lg" variant="secondary" icon="left" aria-label={t("play.prevCharacter")} onClick={onPrev} disabled={disabled} className="size-14 shrink-0 px-0" />
        <button type="button" onClick={onInfo} disabled={!name} className="px-focus flex min-h-14 w-20 min-w-0 flex-col items-center justify-center text-center min-[400px]:w-28" aria-label={t("play.sidebar.open")}>
          <span className="w-full truncate font-head text-sm font-bold text-label">{name ?? "—"}</span>
          {mood && <span className="w-full truncate text-xs text-ink-soft">{mood}</span>}
          <span className="font-label text-[9px] uppercase text-ink-mute underline underline-offset-2">{t("play.sidebar.open")}</span>
        </button>
        <PixelButton size="lg" variant="secondary" icon="right" aria-label={t("play.nextCharacter")} onClick={onNext} disabled={disabled} className="size-14 shrink-0 px-0" />
      </div>
      <PixelButton size="lg" variant="primary" aria-label={t("play.interact")} onClick={onInteract} disabled={disabled} className="h-16 min-w-16 shrink-0 px-2">
        <span className="flex flex-col items-center leading-none">
          <span className="font-shout text-lg">A</span>
          <span className="mt-1 text-xs">{t("play.actions.talk")}</span>
        </span>
      </PixelButton>
    </div>
  );
}
