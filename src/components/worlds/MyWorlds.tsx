"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/ui/LoadingDots";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { Sparkle } from "@/components/ui/Deco";
import { migrateSave, nextStepFor } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import {
  WorldSaveError,
  createWorld,
  deleteWorld,
  duplicateWorld,
  enterWorld,
  markMigrationNoticeSeen,
  peekWorld,
  renameWorld,
  useActiveWorld,
  useWorldIndex,
  type WorldSave,
} from "@/lib/saves/worldSaves";
import { useI18n } from "@/i18n";
import { WorldSaveCard } from "./WorldSaveCard";
import { useMapThumbnails, useWorldName } from "./worldNames";

/** Most recently played first. */
export const byLastPlayed = (a: WorldSave, b: WorldSave) => b.lastPlayedAt - a.lastPlayedAt;

/** Start a brand-new world and go pick its theme. */
export function useCreateWorld() {
  const router = useRouter();
  return () => {
    const w = createWorld();
    if (enterWorld(w.id, "/worlds")) router.push("/worlds");
  };
}

/** Enter a world where it left off. */
export function useContinueWorld() {
  const router = useRouter();
  return (id: string) => {
    const href = nextStepFor(migrateSave(peekWorld(id)));
    if (enterWorld(id, href)) router.push(href);
  };
}

/** The "My Worlds" shelf: every world save as a card, with Continue / Rename / Duplicate / Delete. */
export function MyWorlds({ showHeading = true }: { showHeading?: boolean }) {
  const { t } = useI18n();
  const hydrated = useHydrated();
  const index = useWorldIndex();
  const active = useActiveWorld();
  const nameOf = useWorldName();
  const create = useCreateWorld();
  const continueWorld = useContinueWorld();
  const [busy, setBusy] = useState<{ id: string; kind: "copying" | "deleting" } | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<WorldSave | null>(null);

  const worlds = useMemo(() => [...index.worlds].sort(byLastPlayed), [index.worlds]);
  const thumbs = useMapThumbnails(worlds.map((w) => w.mapId));
  // Card sprite rows read each world's own data; re-read only when that world was saved.
  const versions = worlds.map((w) => `${w.id}:${w.updatedAt}`).join(",");
  const casts = useMemo(() => {
    const out: Record<string, ReturnType<typeof migrateSave>["characters"]> = {};
    if (!hydrated) return out;
    for (const w of worlds) out[w.id] = w.characterCount ? migrateSave(peekWorld(w.id)).characters.slice(0, 6) : [];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `versions` covers every change that matters
  }, [hydrated, versions]);

  const migrated =
    index.migration && (index.migration.status === "migrated" || index.migration.status === "in-place") && !index.migration.noticeSeen
      ? worlds.find((w) => w.id === index.migration?.worldId)
      : undefined;

  const duplicate = async (w: WorldSave) => {
    setBusy({ id: w.id, kind: "copying" });
    setStatus(null);
    try {
      const copy = await duplicateWorld(w.id, t("myWorlds.copyName", { name: nameOf(w) }));
      setStatus({ text: t("myWorlds.copied", { name: nameOf(copy) }) });
    } catch (e) {
      setStatus({ text: e instanceof WorldSaveError && e.code === "unreadable" ? t("myWorlds.copyUnreadable") : t("myWorlds.copyFailed"), error: true });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (w: WorldSave) => {
    setConfirm(null);
    setBusy({ id: w.id, kind: "deleting" });
    await deleteWorld(w.id);
    setBusy(null);
    setStatus({ text: t("myWorlds.deleted", { name: nameOf(w) }) });
  };

  const rename = (w: WorldSave, name: string) => {
    const ok = renameWorld(w.id, name);
    if (ok) setStatus({ text: t("myWorlds.renamed", { name: name.trim() }) });
    return ok;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {showHeading ? (
          <div className="min-w-0">
            <h2
              className="flex items-center gap-2 font-display text-[26px] font-bold leading-tight text-ink sm:text-[34px]"
              style={{ textShadow: "2px 2px 0 var(--color-lavender-hi), 3px 3px 0 var(--color-lavender)" }}
            >
              <Sparkle size={12} twinkle className="text-butter-lo" />
              {t("myWorlds.heading")}
            </h2>
            <p className="mt-1 max-w-xl text-lg leading-snug text-ink-soft">{t("myWorlds.intro")}</p>
          </div>
        ) : (
          <p className="max-w-xl text-lg leading-snug text-ink-soft">{t("myWorlds.intro")}</p>
        )}
        <PixelButton variant="magic" icon="plus" onClick={create} className="w-full sm:w-auto">
          {t("myWorlds.create")}
        </PixelButton>
      </div>

      {migrated && (
        <p className="flex flex-wrap items-center gap-3 bg-mint-hi px-3 py-2 text-base leading-snug shadow-[inset_4px_0_0_var(--color-mint)]" role="note">
          <PixelIcon name="check" size={12} className="shrink-0 text-mint-deep" />
          <span className="min-w-0 flex-1">{t("myWorlds.migrated", { name: nameOf(migrated) })}</span>
          <PixelButton size="sm" variant="ghost" onClick={markMigrationNoticeSeen}>
            {t("myWorlds.dismiss")}
          </PixelButton>
        </p>
      )}

      <p
        aria-live="polite"
        role="status"
        className={
          status ? `px-3 py-2 text-base ${status.error ? "bg-peach-hi shadow-[inset_4px_0_0_var(--color-peach-lo)]" : "bg-butter-hi shadow-[inset_4px_0_0_var(--color-butter-lo)]"}` : "sr-only"
        }
      >
        {status?.text}
      </p>

      {!hydrated ? (
        <LoadingState label={t("common.loadingSave")} />
      ) : worlds.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
            <PixelIcon name="globe" size={40} className="text-ink-mute" />
            <h3 className="font-head text-2xl font-bold">{t("myWorlds.emptyTitle")}</h3>
            <p className="text-lg text-ink-soft">{t("myWorlds.emptyBody")}</p>
            <PixelButton variant="primary" icon="plus" onClick={create}>
              {t("myWorlds.create")}
            </PixelButton>
          </div>
        </Panel>
      ) : (
        <ul className="grid grid-cols-1 gap-6 min-[620px]:grid-cols-2 lg:grid-cols-3" aria-label={t("myWorlds.heading")}>
          {worlds.map((w) => (
            <li key={w.id} className="flex">
              <WorldSaveCard
                world={w}
                name={nameOf(w)}
                current={active?.id === w.id}
                cast={casts[w.id] ?? []}
                thumbnail={w.mapId ? (thumbs[w.mapId] ?? null) : null}
                busy={busy?.id === w.id ? busy.kind : null}
                onContinue={() => continueWorld(w.id)}
                onRename={(name) => rename(w, name)}
                onDuplicate={() => void duplicate(w)}
                onDelete={() => setConfirm(w)}
              />
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t("myWorlds.deleteTitle")}
        closeLabel={t("common.close")}
        size="sm"
        footer={
          <>
            <PixelButton variant="ghost" onClick={() => setConfirm(null)} data-autofocus>
              {t("common.cancel")}
            </PixelButton>
            <PixelButton variant="danger" icon="trash" onClick={() => confirm && void remove(confirm)}>
              {t("myWorlds.deleteConfirm")}
            </PixelButton>
          </>
        }
      >
        {confirm && (
          <div className="flex flex-col gap-3 text-lg leading-snug">
            <p>{t("myWorlds.deleteBody", { name: nameOf(confirm) })}</p>
            <p className="flex items-start gap-2 text-ink-soft">
              <PixelIcon name="check" size={12} className="mt-1.5 shrink-0 text-mint-deep" />
              {t("myWorlds.deleteSafe")}
            </p>
            <p className="flex items-start gap-2 font-bold text-coral-deep">
              <PixelIcon name="trash" size={12} className="mt-1.5 shrink-0" />
              {t("myWorlds.deleteWarn")}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
