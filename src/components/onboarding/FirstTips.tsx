"use client";

import type { CSSProperties } from "react";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useStageSize } from "@/components/game/PixelStage";
import { STAGE } from "@/components/game/SceneSprites";
import type { StageSim } from "@/lib/stage/sim";
import type { WorldObject } from "@/lib/stage/objects";
import { useStageSnapshot } from "@/lib/stage/useStage";
import type { TipId } from "@/lib/onboarding/tips";
import { useI18n } from "@/i18n";

/**
 * FIRST-TIME TIPS — the visible half of lib/onboarding/tips.ts.
 *
 *   <TipCard>    one short tip in the dialogue dock (never over the stage), with Skip tips
 *   <TipStage>   what the tip points at, drawn on the stage: a ghost hand dragging from
 *                one character to another (desktop), tapping a character (touch), or a
 *                soft outline pulsing round an object. Never catches the pointer.
 */

export type TipView = {
  tip: TipId;
  /** Who the talk / contrast tips name: drag (or tap) `a` onto `b`. */
  a?: { id: string; name: string } | null;
  b?: { id: string; name: string } | null;
  /** The object the object tip names. */
  object?: { id: string; name: string } | null;
  /** A one-line "it worked" note for what the player just did. */
  win?: string | null;
};

export function TipCard({ view, touch, onSkip, onNewWorld, onEditCast, onKeepPlaying }: { view: TipView; touch: boolean; onSkip: () => void; onNewWorld: () => void; onEditCast: () => void; onKeepPlaying: () => void }) {
  const { t } = useI18n();
  const a = view.a?.name ?? "";
  const b = view.b?.name ?? "";
  let main: string | null = null;
  let sub: string | null = null;
  if (view.tip === "talk") {
    main = touch ? t("tips.talkTouch", { a, b }) : t("tips.talkDrag", { a, b });
    sub = touch ? t("tips.talkTouchOr", { a, b }) : t("tips.talkClick", { a });
  } else if (view.tip === "contrast") main = t("tips.contrast", { a, b });
  else if (view.tip === "object") main = touch ? t("tips.objectTouch", { object: view.object?.name ?? t("tips.objectThing") }) : t("tips.objectDrag", { object: view.object?.name ?? t("tips.objectThing") });
  else if (view.tip === "watch") main = t("tips.watch");

  return (
    <section aria-label={t("tips.label")} role="status" className="panel-pad-x flex flex-col gap-1.5 bg-butter-hi py-2 shadow-[inset_4px_0_0_var(--color-butter-lo)]" data-tip={view.tip}>
      {view.win && (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug text-mint-deep" data-tip-win>
          <PixelIcon name="check" size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{view.win}</span>
        </p>
      )}
      {view.tip === "makeOwn" ? (
        <>
          <p className="font-head text-base font-bold leading-tight">{t("tips.makeOwnTitle")}</p>
          <div className="flex flex-wrap gap-2">
            <PixelButton size="sm" variant="magic" icon="plus" onClick={onNewWorld} className="px-2" data-tip-new-world>
              {t("tips.newWorld")}
            </PixelButton>
            <PixelButton size="sm" variant="calm" icon="user" onClick={onEditCast} className="px-2" data-tip-edit-cast>
              {t("tips.editCast")}
            </PixelButton>
            <PixelButton size="sm" variant="ghost" icon="play" onClick={onKeepPlaying} className="px-2" data-tip-keep-playing>
              {t("tips.keepPlaying")}
            </PixelButton>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <PixelIcon name={view.tip === "watch" ? "eye" : "hand"} size={14} className="mt-0.5 shrink-0 text-label" />
          <p className="min-w-0 flex-1 text-[15px] leading-snug">
            <span className="font-bold">{main}</span>
            {sub && <span className="block text-[13px] text-ink-soft">{sub}</span>}
          </p>
          <button type="button" onClick={onSkip} className="px-focus -my-1 shrink-0 px-1 py-1 font-label text-[10px] uppercase text-ink-soft underline decoration-dotted underline-offset-4 hover:text-ink" data-tip-skip>
            {t("tips.skip")}
          </button>
        </div>
      )}
    </section>
  );
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** Drawn in the stage overlay (world coordinates as percentages). */
export function TipStage({ view, stage, objects, touch }: { view: TipView; stage: StageSim; objects: WorldObject[]; touch: boolean }) {
  const snap = useStageSnapshot(stage);
  const size = useStageSize();
  const pos = (id: string | undefined) => (id ? snap.actors.find((x) => x.id === id) : undefined);

  if (view.tip === "talk" || view.tip === "contrast") {
    const A = pos(view.a?.id);
    const B = pos(view.b?.id);
    if (!A || !B) return null;
    // The hand's fingertip sits on the character's chest.
    const ay = A.y - STAGE.sprite * 0.45;
    const by = B.y - STAGE.sprite * 0.45;
    const ring = (x: number, y: number, key: string) => (
      <span key={key} aria-hidden className="tip-pulse pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-label" style={{ left: pct(x, size.width), top: pct(y, size.height), width: "2.6em", height: "2.6em" }} />
    );
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0" data-tip-stage={view.tip}>
        {ring(B.x, by, "b")}
        {touch && ring(A.x, ay, "a")}
        <span
          className={`tip-hand ${touch ? "is-tap" : "is-drag"}`}
          style={{ "--x0": pct(A.x, size.width), "--y0": pct(ay, size.height), "--x1": pct(B.x, size.width), "--y1": pct(by, size.height), left: pct(A.x, size.width), top: pct(ay, size.height) } as CSSProperties}
        >
          <PixelIcon name="hand" size={20} />
        </span>
      </div>
    );
  }

  if (view.tip === "object" && view.object) {
    const o = objects.find((x) => x.id === view.object!.id);
    if (!o) return null;
    const b = o.bounds;
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0" data-tip-stage="object">
        <span className="tip-pulse absolute z-20 outline-2 outline-dashed outline-offset-2 outline-label" style={{ left: pct(b.x0, size.width), top: pct(b.y0, size.height), width: pct(b.x1 - b.x0, size.width), height: pct(b.y1 - b.y0, size.height) }} />
      </div>
    );
  }
  return null;
}

/** Hover / focus feedback for objects: a dashed outline and the object's name (never catches the pointer). */
export function ObjectHover({ object, name }: { object: WorldObject | null; name: string }) {
  const size = useStageSize();
  if (!object) return null;
  const b = object.bounds;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-object-hover={object.id}>
      <span className="absolute z-20 outline-1 outline-dashed outline-offset-1 outline-label" style={{ left: pct(b.x0, size.width), top: pct(b.y0, size.height), width: pct(b.x1 - b.x0, size.width), height: pct(b.y1 - b.y0, size.height) }} />
      <span className="absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap bg-white/95 px-1 py-[1px] font-head text-[11px] font-bold text-ink shadow-[inset_0_-2px_0_var(--color-lavender)] sm:text-xs" style={{ left: pct((b.x0 + b.x1) / 2, size.width), top: `calc(${pct(b.y0, size.height)} - 3px)` }}>
        {name}
      </span>
    </div>
  );
}
