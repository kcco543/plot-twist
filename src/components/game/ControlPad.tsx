"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useI18n } from "@/i18n";

/**
 * Character row at the bottom of the dialogue dock (every screen size):
 * ◀ ▶ choose a character, the middle button opens their character info
 * (a drawer on phones, the details panel under the play area on desktop).
 */
export function ControlPad({
  name,
  mood,
  onPrev,
  onNext,
  onInfo,
  infoOpen = false,
  disabled,
}: {
  name: string | null;
  mood: string | null;
  onPrev: () => void;
  onNext: () => void;
  onInfo: () => void;
  /** The details panel is open (desktop): the button reads "hide". */
  infoOpen?: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("play.controls")} className="panel-pad-x flex items-center gap-1.5 py-1" data-control-pad>
      <PixelButton size="sm" variant="secondary" icon="left" aria-label={t("play.prevCharacter")} onClick={onPrev} disabled={disabled} className="size-11 shrink-0 px-0" />
      <button
        type="button"
        onClick={onInfo}
        disabled={!name}
        aria-expanded={infoOpen}
        className="px-focus flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 px-1 text-center hover:bg-well disabled:opacity-50"
        aria-label={infoOpen ? t("play.sidebar.close") : t("play.sidebar.open")}
        data-character-info-toggle
      >
        <span className="min-w-0 truncate font-head text-[15px] font-bold leading-tight text-label">{name ?? "—"}</span>
        {mood && <span className="min-w-0 shrink truncate text-sm text-ink-soft">{mood}</span>}
        <span className="flex shrink-0 items-center gap-1 font-label text-[9px] uppercase text-ink-mute">
          <PixelIcon name="user" size={10} />
          <span className="hidden @[20rem]:inline">{infoOpen ? t("play.sidebar.hide") : t("play.sidebar.open")}</span>
        </span>
      </button>
      <PixelButton size="sm" variant="secondary" icon="right" aria-label={t("play.nextCharacter")} onClick={onNext} disabled={disabled} className="size-11 shrink-0 px-0" />
    </div>
  );
}
