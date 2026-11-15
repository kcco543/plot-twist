"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useI18n } from "@/i18n";
import type { GiftMoment } from "./useGiftMoment";

/** Under the dialogue box after a gift: what the character did with it and what they made of it. */
export function GiftMomentCard({ moment, onDismiss, onOpenThings }: { moment: GiftMoment; onDismiss: () => void; onOpenThings?: () => void }) {
  const { t } = useI18n();
  const { name, v, gift } = moment;
  const outcome = v.decision === "refuse" ? "refused" : v.decision === "indifferent" ? "indifferent" : "accepted";
  return (
    <section aria-label={t("keepsakes.giftMoment.title", { name })} className="content-block flex gap-3 bg-mint-hi px-3 py-2.5 shadow-[inset_4px_0_0_var(--color-mint)]" data-gift-moment={v.display}>
      <div className="px-checker grid size-16 shrink-0 place-items-center self-start shadow-[0_0_0_2px_var(--color-lavender-lo)]">
        {gift.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gift.image} alt={t("keepsakes.things.alt", { gift: gift.name })} width={48} height={48} className="pixelated" />
        ) : (
          <PixelIcon name="gift" size={24} className="text-ink-mute" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-2 font-head text-base leading-tight font-bold">
          {t("keepsakes.giftMoment.title", { name })}
          {moment.source === "mock" && <span className="bg-butter-lo px-1 font-label text-[10px] font-normal text-ink">{t("keepsakes.photo.testTag")}</span>}
        </p>
        <p className="text-sm text-ink-soft">{t(`keepsakes.giftMoment.${outcome}`, { name, gift: gift.name })}</p>
        {v.display !== "refused" && (
          <p className="font-label text-[10px] uppercase text-label" data-gift-state={v.display}>
            {t("keepsakes.giftMoment.where", { state: t(`keepsakes.giftState.${v.display}`) })}
            {v.keepReason && <span className="normal-case font-body text-xs text-ink-soft"> · {v.keepReason}</span>}
          </p>
        )}
        {v.interpretation && (
          <p className="text-sm break-words text-ink-soft">
            <span className="font-label text-[9px] uppercase text-label">{t("keepsakes.giftMoment.thinks", { name })}</span> {v.interpretation}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          {onOpenThings && v.display !== "refused" && (
            <PixelButton size="sm" variant="calm" icon="gift" onClick={onOpenThings} className="px-2" data-gift-open-things>
              {t("keepsakes.giftMoment.open", { name })}
            </PixelButton>
          )}
          <PixelButton size="sm" variant="ghost" icon="check" onClick={onDismiss} className="px-2" data-gift-done>
            {t("keepsakes.done")}
          </PixelButton>
        </div>
      </div>
    </section>
  );
}

/** Displayed gifts drawn on the scene's display spots (on furniture, never on the walkable floor). */
export function StageGifts({ placed, nameOf }: { placed: { gift: { id: string; name: string; image: string | null; owner: string }; spot: { id: string; x: number; y: number } }[]; nameOf: (id: string) => string }) {
  const { t } = useI18n();
  return (
    <>
      {placed.map(({ gift, spot }) => (
        <div
          key={gift.id}
          className="pointer-events-none absolute grid place-items-center"
          style={{ left: spot.x - 8, top: spot.y - 16, width: 16, height: 16, zIndex: spot.y }}
          role="img"
          aria-label={t("keepsakes.things.onStage", { owner: nameOf(gift.owner), gift: gift.name })}
          data-stage-gift={gift.id}
          data-spot={spot.id}
        >
          {gift.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gift.image} alt="" width={16} height={16} className="pixelated" />
          ) : (
            <PixelIcon name="gift" size={12} className="text-rose" />
          )}
        </div>
      ))}
    </>
  );
}
