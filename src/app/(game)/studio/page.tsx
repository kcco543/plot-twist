"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { CharacterEditor, type StudioTab } from "@/components/game/CharacterEditor";
import { CharacterRoster } from "@/components/game/CharacterRoster";
import { LoadingState } from "@/components/ui/LoadingDots";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { LibraryPicker } from "@/components/library/LibraryPicker";
import { OriginalModal } from "@/components/library/OriginalModal";
import { WorldVersionBar } from "@/components/library/WorldVersionBar";
import { useWorldName } from "@/components/worlds/worldNames";
import { gameActions, useSave } from "@/lib/gameStore";
import { libraryActions, useLibrary, type CharacterTemplate } from "@/lib/library/characterLibrary";
import { useActiveWorld } from "@/lib/saves/worldSaves";
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
  const [tab, setTab] = useState<StudioTab>("profile");
  const [picking, setPicking] = useState(false);
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const library = useLibrary();
  const activeWorld = useActiveWorld();
  const nameOfWorld = useWorldName();
  const worldName = activeWorld ? nameOfWorld(activeWorld) : t("library.thisWorld");

  const selected = save.characters.find((c) => c.id === pickedId) ?? save.characters[0] ?? null;
  const selectedName = selected?.name.trim() || t("studio.thisCharacter");
  const inLibrary = Boolean(selected?.templateId && library.templates.some((x) => x.id === selected.templateId));

  const add = () => {
    setStatus(null);
    setPickedId(gameActions.addCharacter().id);
  };
  const importTemplate = (tpl: CharacterTemplate) => {
    const c = gameActions.addFromLibrary(tpl);
    setPicking(false);
    setTab("profile");
    setPickedId(c.id);
    setStatus(t("library.added", { name: c.name.trim() || t("common.unnamed"), world: worldName }));
  };
  const saveTemplate = () => {
    if (!selected) return;
    const tpl = libraryActions.saveFromCharacter(selected);
    gameActions.linkToTemplate(selected.id, tpl.id);
    setStatus(t("library.savedTemplate", { name: selected.name.trim() || t("common.unnamed") }));
  };
  const remove = () => {
    if (!selected) return;
    const i = save.characters.findIndex((c) => c.id === selected.id);
    gameActions.removeFromWorld(selected.id);
    setPickedId(save.characters[i + 1]?.id ?? save.characters[i - 1]?.id ?? null);
    setConfirmDelete(false);
  };

  return (
    <>
      <main className="content-grid flex-1 pt-8 sm:pt-10">
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
              <PixelIcon name="user" size={40} className="animate-bob text-label" />
              <h2 className="font-head text-2xl font-bold">{t("studio.emptyTitle")}</h2>
              <p className="text-lg text-ink-soft">{t("studio.emptyBody")}</p>
              <div className="flex flex-wrap justify-center gap-3">
                <PixelButton variant="primary" icon="plus" onClick={add}>
                  {t("library.createNew")}
                </PixelButton>
                <PixelButton variant="magic" icon="book" onClick={() => setPicking(true)}>
                  {t("library.addFromLibrary")}
                </PixelButton>
              </div>
            </div>
          </Panel>
        ) : (
          <div className="grid layout-gap lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="sticky-col min-w-0">
              <p className="mb-2 font-label text-xs uppercase text-ink-soft">{t("studio.castCount", { count: save.characters.length })}</p>
              <CharacterRoster characters={save.characters} selectedId={selected?.id ?? null} onSelect={setPickedId} onAdd={add} onImport={() => setPicking(true)} />
            </aside>
            {selected && (
              <section aria-label={t("studio.editing", { name: selected.name || t("common.unnamed") })} className="min-w-0">
                {status && (
                  <p role="status" className="mb-4 bg-butter-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-butter-lo)]">
                    {status}
                  </p>
                )}
                <WorldVersionBar
                  character={selected}
                  cast={save.characters}
                  story={save.story}
                  worldName={worldName}
                  onViewOriginal={() => setViewingOriginal(true)}
                  onSaveTemplate={saveTemplate}
                  onRemove={() => setConfirmDelete(true)}
                />
                <CharacterEditor
                  key={selected.id}
                  character={selected}
                  tab={tab}
                  onTab={setTab}
                  onChange={(patch) => {
                    setStatus(null);
                    gameActions.updateCharacter(selected.id, patch);
                  }}
                />
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
        title={t("library.removeTitle")}
        closeLabel={t("common.close")}
        size="sm"
        footer={
          <>
            <PixelButton variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t("common.keep")}
            </PixelButton>
            <PixelButton variant="danger" size="sm" icon="trash" onClick={remove}>
              {t("library.removeConfirm")}
            </PixelButton>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-lg leading-snug">
          <p>{t("library.removeBody", { name: selectedName, world: worldName })}</p>
          {inLibrary ? (
            <p className="flex items-start gap-2 text-ink-soft">
              <PixelIcon name="check" size={12} className="mt-1.5 shrink-0 text-mint-deep" />
              {t("library.removeKept")}
            </p>
          ) : (
            <p className="flex items-start gap-2 font-bold text-coral-deep">
              <PixelIcon name="book" size={12} className="mt-1.5 shrink-0" />
              {t("library.removeNotSaved", { name: selectedName })}
            </p>
          )}
        </div>
      </Modal>

      <LibraryPicker open={picking} onClose={() => setPicking(false)} worldName={worldName} cast={save.characters} onPick={importTemplate} />
      <OriginalModal
        character={viewingOriginal ? selected : null}
        onClose={() => setViewingOriginal(false)}
        onEditHere={() => {
          setViewingOriginal(false);
          setTab("profile");
        }}
      />
    </>
  );
}
