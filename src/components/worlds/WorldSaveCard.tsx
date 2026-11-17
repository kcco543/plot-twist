"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { CornerSparkles } from "@/components/ui/Deco";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { worldArt } from "@/assets/manifest";
import { artFor } from "@/lib/character/art";
import { WORLD_NAME_MAX } from "@/lib/saves/format";
import type { WorldSave } from "@/lib/saves/worldSaves";
import type { Character } from "@/lib/types";
import { getWorld } from "@/lib/worlds";
import { useI18n } from "@/i18n";

/** Where this world is saved, shown while signed in to cloud saves. */
export type CardSync = "cloud" | "device" | "conflict" | null;

type Props = {
  world: WorldSave;
  name: string;
  current: boolean;
  /** Up to 6 characters, for the little sprite row. */
  cast: Pick<Character, "id" | "name" | "portrait" | "art">[];
  thumbnail: string | null;
  busy: "copying" | "deleting" | null;
  onContinue: () => void;
  onRename: (name: string) => boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  sync?: CardSync;
  onExport?: () => void;
  onResolve?: () => void;
};

/** One world save on the My Worlds shelf. */
export function WorldSaveCard({ world, name, current, cast, thumbnail, busy, onContinue, onRename, onDuplicate, onDelete, sync = null, onExport, onResolve }: Props) {
  const { t, tx, locale } = useI18n();
  const theme = getWorld(world.theme);
  const themeName = theme ? tx(`worlds.list.${theme.id}.name`) : t("myWorlds.noTheme");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const startRename = () => {
    setDraft(name);
    setEditing(true);
  };
  const stopRename = () => {
    setEditing(false);
    requestAnimationFrame(() => document.getElementById(`rename-btn-${world.id}`)?.focus());
  };
  const save = () => {
    if (onRename(draft)) stopRename();
  };

  const count = world.characterCount;
  const played = new Date(world.lastPlayedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <article
      aria-label={name}
      className={`px-frame px-shadow relative flex w-full flex-col ${current ? "px-selected" : ""}`}
      style={{ "--frame": `var(--frame-${current ? "gold-card" : theme ? theme.frame : "card"})` } as CSSProperties}
    >
      {current && <CornerSparkles />}
      <div className="relative aspect-[16/9] overflow-hidden border-2 border-outline/40 bg-well">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated pixel map, must not be resampled
          <img src={thumbnail} alt={t("myWorlds.previewAlt", { name })} className="pixelated absolute inset-0 h-full w-full object-cover" draggable={false} />
        ) : theme ? (
          <ArtImage art={worldArt[theme.id]} alt={t("myWorlds.previewAlt", { name })} fit="cover" showTag={false} className="absolute inset-0 h-full w-full" />
        ) : (
          <div className="px-checker absolute inset-0 grid place-items-center">
            <PixelIcon name="globe" size={32} className="text-ink-mute" />
          </div>
        )}
        <span
          className="absolute left-1 top-1 flex max-w-[70%] items-center gap-1 bg-white/90 px-1.5 py-1 font-label text-[10px] uppercase leading-none shadow-[1px_1px_0_rgba(91,74,134,0.25)]"
          style={{ color: theme?.accent ?? "var(--color-ink-soft)" }}
        >
          <PixelIcon name={theme?.icon ?? "globe"} size={10} />
          <span className="truncate">{themeName}</span>
        </span>
        {current && (
          <span className="absolute right-1 top-1 flex items-center gap-1 bg-butter px-1.5 py-1 font-label text-[10px] uppercase leading-none text-ink shadow-[1px_1px_0_var(--color-butter-lo)]">
            <PixelIcon name="play" size={9} /> {t("myWorlds.current")}
          </span>
        )}
        {cast.length > 0 && (
          <span className="absolute bottom-1 left-1 flex gap-0.5 bg-white/85 p-0.5" aria-hidden>
            {cast.map((c) => (
              <ArtImage key={c.id} art={artFor(c).sprite} alt="" showTag={false} className="w-6 sm:w-7" />
            ))}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 px-1 pt-3 pb-1">
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="font-label text-xs uppercase tracking-wide text-label" htmlFor={`rename-${world.id}`}>
              {t("myWorlds.nameLabel")}
            </label>
            <input
              ref={input}
              id={`rename-${world.id}`}
              className="px-input"
              value={draft}
              maxLength={WORLD_NAME_MAX}
              placeholder={t("myWorlds.namePlaceholder")}
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  stopRename();
                }
              }}
            />
            <div className="flex gap-2">
              <PixelButton type="submit" size="sm" variant="success" icon="check" disabled={!draft.trim()} className="flex-1">
                {t("myWorlds.save")}
              </PixelButton>
              <PixelButton type="button" size="sm" variant="ghost" icon="close" onClick={stopRename} aria-label={t("myWorlds.cancelRename")} className="min-w-11" />
            </div>
          </form>
        ) : (
          <h3 className="font-head text-xl font-bold leading-tight text-ink [overflow-wrap:anywhere] sm:text-[22px]">{name}</h3>
        )}

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-base">
          <dt className="font-label text-[10px] uppercase text-rose">{t("myWorlds.theme")}</dt>
          <dd style={{ color: theme?.accent }} className={theme ? "" : "text-ink-mute"}>
            {themeName}
          </dd>
          <dt className="font-label text-[10px] uppercase text-rose">{t("load.cast")}</dt>
          <dd className={count ? "" : "text-ink-mute"}>{count === 0 ? t("myWorlds.noCharacters") : count === 1 ? t("myWorlds.character") : t("myWorlds.characters", { count })}</dd>
          <dt className="font-label text-[10px] uppercase text-rose">{t("myWorlds.lastPlayed")}</dt>
          <dd className="tabular-nums text-ink-soft">{played}</dd>
        </dl>

        {sync && (
          <p
            data-testid="card-sync"
            data-sync={sync}
            className={`flex items-center gap-1.5 font-label text-[10px] uppercase ${sync === "conflict" ? "text-coral-deep" : sync === "cloud" ? "text-mint-deep" : "text-ink-soft"}`}
          >
            <PixelIcon name={sync === "conflict" ? "layers" : sync === "cloud" ? "cloud" : "phone"} size={10} />
            {sync === "conflict" ? t("sync.cardConflict") : sync === "cloud" ? t("sync.cardCloud") : t("sync.cardDevice")}
            {sync === "conflict" && onResolve && (
              <button type="button" className="px-focus ml-auto underline underline-offset-2" onClick={onResolve}>
                {t("sync.cardResolve")}
              </button>
            )}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 border-t-[3px] border-dashed border-line pt-3">
          <PixelButton variant="primary" icon="play" onClick={onContinue} disabled={busy !== null}>
            {t("myWorlds.continue")}
          </PixelButton>
          <div role="group" aria-label={t("myWorlds.actions", { name })} className={`grid gap-1.5 ${onExport ? "grid-cols-2" : "grid-cols-3"}`}>
            <PixelButton id={`rename-btn-${world.id}`} size="sm" variant="ghost" icon="pencil" onClick={startRename} disabled={editing || busy !== null} className="px-1 text-sm">
              {t("myWorlds.rename")}
            </PixelButton>
            <PixelButton size="sm" variant="ghost" icon="plus" onClick={onDuplicate} loading={busy === "copying"} disabled={busy !== null} className="px-1 text-sm">
              {busy === "copying" ? t("myWorlds.copying") : t("myWorlds.duplicate")}
            </PixelButton>
            <PixelButton size="sm" variant="ghost" icon="trash" onClick={onDelete} disabled={busy !== null} className="px-1 text-sm text-coral-deep">
              {t("myWorlds.delete")}
            </PixelButton>
            {onExport && (
              <PixelButton size="sm" variant="ghost" icon="down" onClick={onExport} disabled={busy !== null} className="px-1 text-sm">
                {t("sync.exportWorld")}
              </PixelButton>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
