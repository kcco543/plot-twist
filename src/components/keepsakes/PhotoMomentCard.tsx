"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useI18n } from "@/i18n";
import type { PhotoMoment } from "./usePhotoMoment";

/**
 * Under the dialogue box after a character reacted to a photo: the photo,
 * and the choice to keep the moment as one of their memories. Nothing is
 * stored until "Save as memory"; "Not now" lets the photo go.
 */
export function PhotoMomentCard({ moment, onSave, onDismiss, onOpenMemories }: { moment: PhotoMoment; onSave: () => void; onDismiss: () => void; onOpenMemories?: () => void }) {
  const { t } = useI18n();
  const { name, v, state } = moment;
  const saved = state === "saved";
  const hint = saved ? t("keepsakes.moment.saved", { name }) : v.clarity === "unclear" ? t("keepsakes.moment.unclear", { name }) : v.memory.suggested ? t("keepsakes.moment.suggest", { name }) : null;
  return (
    <section
      aria-label={t("keepsakes.moment.title", { name })}
      className="content-block flex gap-3 bg-pink-hi px-3 py-2.5 shadow-[inset_4px_0_0_var(--color-rose)]"
      data-photo-moment={state}
      data-photo-suggested={v.memory.suggested ? "yes" : "no"}
    >
      <figure className="w-16 shrink-0 rotate-[-2deg] self-start bg-surface p-1 pb-2 shadow-[0_0_0_2px_var(--color-lavender-lo)] sm:w-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={moment.url} alt={t("keepsakes.moment.thumbAlt", { name })} className="aspect-square w-full object-cover" />
      </figure>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="flex flex-wrap items-center gap-2 font-head text-base leading-tight font-bold">
          {t("keepsakes.moment.title", { name })}
          {moment.source === "mock" && <span className="bg-butter-lo px-1 font-label text-[10px] font-normal text-ink">{t("keepsakes.photo.testTag")}</span>}
        </p>
        {v.memory.description && !saved && <p className="text-sm break-words text-ink-soft" data-photo-description>{v.memory.description}</p>}
        {hint && (
          <p className="flex items-start gap-1.5 text-sm text-ink-soft" role={saved ? "status" : undefined}>
            <PixelIcon name={saved ? "check" : "heart"} size={10} className="mt-1 shrink-0 text-rose" />
            {hint}
          </p>
        )}
        {state === "failed" && (
          <p className="text-sm text-ink" role="alert">
            {t("keepsakes.moment.saveFailed")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {saved ? (
            <>
              {onOpenMemories && (
                <PixelButton size="sm" variant="calm" icon="book" onClick={onOpenMemories} className="px-2">
                  {t("keepsakes.moment.open")}
                </PixelButton>
              )}
              <PixelButton size="sm" variant="ghost" icon="check" onClick={onDismiss} className="px-2" data-photo-done>
                {t("keepsakes.done")}
              </PixelButton>
            </>
          ) : (
            <>
              <PixelButton size="sm" variant={v.memory.suggested ? "primary" : "calm"} icon="heart" loading={state === "saving"} onClick={onSave} className="px-2" data-photo-save>
                {t("keepsakes.moment.save")}
              </PixelButton>
              <PixelButton size="sm" variant="ghost" onClick={onDismiss} disabled={state === "saving"} className="px-2" data-photo-dismiss>
                {t("keepsakes.moment.notNow")}
              </PixelButton>
            </>
          )}
        </div>
        {!saved && <p className="text-xs text-ink-mute">{t("keepsakes.moment.privacy")}</p>}
      </div>
    </section>
  );
}
