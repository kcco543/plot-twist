"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { useI18n } from "@/i18n";

/**
 * Touch controls for phones/tablets. They map onto the actions Play Mode
 * already has: ◀ ▶ choose a character, A talks to them.
 * (There is no free movement or map collision in this version yet.)
 */
export function ControlPad({ name, onPrev, onNext, onInteract, disabled }: { name: string | null; onPrev: () => void; onNext: () => void; onInteract: () => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("play.controls")} className="flex items-center justify-between gap-3 border-t-[3px] border-dashed border-line pt-4 lg:hidden">
      <div className="flex items-center gap-2">
        <PixelButton size="lg" variant="secondary" icon="left" aria-label={t("play.prevCharacter")} onClick={onPrev} disabled={disabled} className="size-14 px-0" />
        <span className="w-20 truncate text-center font-head text-sm font-bold text-label min-[400px]:w-24">{name ?? "—"}</span>
        <PixelButton size="lg" variant="secondary" icon="right" aria-label={t("play.nextCharacter")} onClick={onNext} disabled={disabled} className="size-14 px-0" />
      </div>
      <PixelButton size="lg" variant="primary" aria-label={t("play.interact")} onClick={onInteract} disabled={disabled} className="h-16 min-w-16 px-2">
        <span className="flex flex-col items-center leading-none">
          <span className="font-shout text-lg">A</span>
          <span className="mt-1 text-xs">{t("play.actions.talk")}</span>
        </span>
      </PixelButton>
    </div>
  );
}
