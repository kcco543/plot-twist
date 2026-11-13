"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { CharacterEditor } from "@/components/game/CharacterEditor";
import { CharacterRoster } from "@/components/game/CharacterRoster";
import { LoadingState } from "@/components/ui/LoadingDots";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { gameActions, useSave } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import { getWorld } from "@/lib/worlds";
import { useI18n } from "@/i18n";
import { Rich } from "@/i18n/Rich";

export default function CharacterStudioPage() {
  const { t } = useI18n();
  const router = useRouter();
  const hydrated = useHydrated();
  const save = useSave();
  const world = getWorld(save.worldId);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = save.characters.find((c) => c.id === pickedId) ?? save.characters[0] ?? null;

  const add = () => setPickedId(gameActions.addCharacter().id);
  const remove = () => {
    if (!selected) return;
    const i = save.characters.findIndex((c) => c.id === selected.id);
    gameActions.deleteCharacter(selected.id);
    setPickedId(save.characters[i + 1]?.id ?? save.characters[i - 1]?.id ?? null);
    setConfirmDelete(false);
  };

  return (
    <>
      <main className="gutter mx-auto w-full max-w-6xl flex-1 pt-8 sm:pt-10">
        <ScreenHeader kicker={t("studio.kicker")} title={t("studio.heading")}>
          {world ? (
            <Rich template={t("studio.introWorld")} values={{ world: <span style={{ color: world.accent }}>{t(`worlds.list.${world.id}.name` as const)}</span> }} />
          ) : (
            t("studio.intro")
          )}
        </ScreenHeader>

        {!hydrated ? (
          <LoadingState label={t("common.loadingSave")} />
        ) : save.characters.length === 0 ? (
          <Panel className="mx-auto max-w-xl">
            <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
              <PixelIcon name="user" size={40} className="animate-bob text-butter" />
              <h2 className="font-head text-2xl font-bold">{t("studio.emptyTitle")}</h2>
              <p className="text-lg text-cream-dim">{t("studio.emptyBody")}</p>
              <PixelButton variant="primary" icon="plus" onClick={add}>
                {t("studio.create")}
              </PixelButton>
            </div>
          </Panel>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <p className="mb-2 font-label text-xs uppercase text-cream-dim">{t("studio.castCount", { count: save.characters.length })}</p>
              <CharacterRoster characters={save.characters} selectedId={selected?.id ?? null} onSelect={setPickedId} onAdd={add} />
            </aside>
            {selected && (
              <section aria-label={t("studio.editing", { name: selected.name || t("common.unnamed") })} className="min-w-0">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-2 font-label text-xs uppercase text-mint" role="status">
                    <PixelIcon name="check" size={12} /> {t("common.autosaved")}
                  </p>
                  <PixelButton variant="ghost" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                    {t("common.delete")}
                  </PixelButton>
                </div>
                <CharacterEditor key={selected.id} character={selected} onChange={(patch) => gameActions.updateCharacter(selected.id, patch)} />
              </section>
            )}
          </div>
        )}
      </main>

      <ActionBar>
        <PixelLink href="/worlds" variant="ghost" icon="left">
          {t("studio.backToWorlds")}
        </PixelLink>
        <PixelButton variant="primary" iconRight="right" disabled={save.characters.length === 0} onClick={() => router.push("/builder")}>
          {t("studio.next")}
        </PixelButton>
      </ActionBar>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("studio.deleteTitle")}
        closeLabel={t("common.close")}
        size="sm"
        footer={
          <>
            <PixelButton variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t("common.keep")}
            </PixelButton>
            <PixelButton variant="danger" size="sm" icon="trash" onClick={remove}>
              {t("common.delete")}
            </PixelButton>
          </>
        }
      >
        <p className="text-lg">{t("studio.deleteBody", { name: selected?.name.trim() || t("studio.thisCharacter") })}</p>
      </Modal>
    </>
  );
}
