"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { PixelStage } from "@/components/game/PixelStage";
import { ArtImage } from "@/components/ui/ArtImage";
import { Field } from "@/components/ui/Field";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { defaultWorld, environmentArt } from "@/assets/manifest";
import { ENVIRONMENT_TYPES } from "@/lib/environments";
import { gameActions, useSave } from "@/lib/gameStore";
import { activeMapGenerator, type MapPreview } from "@/lib/mapGenerator";
import { getWorld } from "@/lib/worlds";
import { useI18n } from "@/i18n";

export default function WorldBuilderPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const save = useSave();
  const world = getWorld(save.worldId);
  const { description, type } = save.environment;
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const worldName = world ? t(`worlds.list.${world.id}.name` as const) : "";
  const envName = t(`environments.${type}.name` as const);
  const title = world ? `${worldName} · ${envName}` : envName;

  // Ask the (currently placeholder) map generator for a preview when the inputs change.
  useEffect(() => {
    let cancelled = false;
    activeMapGenerator.generate({ worldId: save.worldId, type, description, locale }).then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [save.worldId, type, description, locale]);

  const previewPanel = (
    <Panel
      title={t("builder.preview")}
      titleRight={
        <span className="mt-1 bg-plum-900 px-1.5 py-1 font-label text-[10px] uppercase text-cream-dim">
          {preview ? t(preview.source === "generated" ? "builder.sourceGenerated" : "builder.sourcePlaceholder") : <LoadingDots />}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {preview ? (
          <PixelStage art={preview.art} label={t("builder.previewAlt", { title })} frame={world?.frame ?? "card"}>
            <span className="absolute left-1 top-1 bg-ink/85 px-1 py-[1px] font-label text-[6px] uppercase leading-none text-cream">{title}</span>
          </PixelStage>
        ) : (
          <p role="status" className="flex aspect-[5/3] items-center justify-center gap-2 font-label text-xs uppercase text-cream-dim">
            {t("builder.generating")} <LoadingDots />
          </p>
        )}
        <p className="min-h-12 text-lg leading-snug text-cream-dim">{description.trim() ? `“${description.trim()}”` : t("builder.quoteEmpty")}</p>
      </div>
    </Panel>
  );

  return (
    <>
      <main className="gutter mx-auto w-full max-w-6xl flex-1 pt-8 sm:pt-10">
        <ScreenHeader kicker={t("builder.kicker")} title={t("builder.heading")}>
          {t("builder.intro")}
        </ScreenHeader>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex min-w-0 flex-col gap-8">
            <Panel title={t("builder.description")}>
              <Field
                label={t("builder.describeLabel")}
                multiline
                rows={5}
                maxLength={600}
                value={description}
                onChange={(v) => gameActions.updateEnvironment({ description: v })}
                placeholder={t("builder.describePlaceholder")}
                hint={t("builder.describeHint")}
              />
            </Panel>

            {/* On phones the preview sits right under the description, before the type picker. */}
            <div className="lg:hidden">{previewPanel}</div>

            <Panel title={t("builder.type")}>
              <div role="radiogroup" aria-label={t("builder.type")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {ENVIRONMENT_TYPES.map((env) => {
                  const active = env === type;
                  return (
                    <button
                      key={env}
                      role="radio"
                      aria-checked={active}
                      title={t(`environments.${env}.hint` as const)}
                      onClick={() => gameActions.updateEnvironment({ type: env })}
                      className={`px-frame px-focus flex flex-col text-left transition-transform duration-100 ${active ? "" : "hover:-translate-y-0.5"}`}
                      style={{ "--frame": `var(--frame-${active ? "gold-card" : "card"})` } as React.CSSProperties}
                    >
                      <ArtImage art={environmentArt[save.worldId ?? defaultWorld][env]} alt="" showTag={false} className="w-full border-2 border-ink" />
                      <span className={`pt-2 font-head text-base font-bold leading-tight ${active ? "text-butter" : "text-cream"}`}>{t(`environments.${env}.name` as const)}</span>
                      <span className="text-sm leading-snug text-cream-dim">{t(`environments.${env}.hint` as const)}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="hidden min-w-0 lg:sticky lg:top-24 lg:block lg:self-start">{previewPanel}</div>
        </div>
      </main>

      <ActionBar>
        <PixelLink href="/studio" variant="ghost" icon="left">
          {t("builder.backToCast")}
        </PixelLink>
        <PixelButton variant="primary" icon="play" onClick={() => router.push("/play")}>
          {t("builder.play")}
        </PixelButton>
      </ActionBar>
    </>
  );
}
