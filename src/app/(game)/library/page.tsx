"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { CharacterEditor, type StudioTab } from "@/components/game/CharacterEditor";
import { TemplatePreview } from "@/components/library/TemplateCard";
import { useWorldName } from "@/components/worlds/worldNames";
import { LoadingState } from "@/components/ui/LoadingDots";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { gameActions } from "@/lib/gameStore";
import { libraryActions, useLibrary } from "@/lib/library/characterLibrary";
import { useHydrated } from "@/lib/persistentStore";
import { useActiveWorld } from "@/lib/saves/worldSaves";
import { useI18n } from "@/i18n";

/** The Character Library: reusable originals, kept apart from every world. */
export default function CharacterLibraryPage() {
  const { t } = useI18n();
  const hydrated = useHydrated();
  const library = useLibrary();
  const activeWorld = useActiveWorld();
  const nameOfWorld = useWorldName();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [tab, setTab] = useState<StudioTab>("profile");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // /library?open=<id> (from "View Original Character").
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setPickedId(id);
  }, []);

  const templates = library.templates;
  const selected = templates.find((x) => x.id === pickedId) ?? templates[0] ?? null;
  const name = selected?.name.trim() || t("library.unnamedOriginal");
  const worldName = activeWorld ? nameOfWorld(activeWorld) : null;

  const create = () => {
    setStatus(null);
    setTab("profile");
    setPickedId(libraryActions.createBlank().id);
  };
  const addToWorld = () => {
    if (!selected || !worldName) return;
    gameActions.addFromLibrary(selected);
    setStatus(t("library.added", { name, world: worldName }));
  };
  const remove = () => {
    if (!selected) return;
    const i = templates.findIndex((x) => x.id === selected.id);
    libraryActions.remove(selected.id);
    setPickedId(templates[i + 1]?.id ?? templates[i - 1]?.id ?? null);
    setConfirmDelete(false);
  };

  return (
    <>
      <main className="content-grid flex-1 pt-8 sm:pt-10">
        <ScreenHeader kicker={t("library.kicker")} title={t("library.heading")}>
          {t("library.intro")}
        </ScreenHeader>

        {!hydrated ? (
          <LoadingState label={t("common.loading")} />
        ) : templates.length === 0 ? (
          <Panel className="mx-auto max-w-xl">
            <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
              <PixelIcon name="book" size={40} className="animate-bob text-label" />
              <h2 className="font-head text-2xl font-bold">{t("library.emptyTitle")}</h2>
              <p className="text-lg text-ink-soft">{t("library.emptyBody")}</p>
              <PixelButton variant="primary" icon="plus" onClick={create}>
                {t("library.createNew")}
              </PixelButton>
            </div>
          </Panel>
        ) : (
          <div className="grid layout-gap lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="sticky-col min-w-0">
              <p className="mb-2 font-label text-xs uppercase text-ink-soft">{templates.length === 1 ? t("library.countOne") : t("library.count", { count: templates.length })}</p>
              <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0" aria-label={t("library.list")}>
                {templates.map((tpl) => {
                  const active = tpl.id === selected?.id;
                  return (
                    <li key={tpl.id} className="shrink-0 snap-start lg:shrink">
                      <button
                        onClick={() => {
                          setStatus(null);
                          setPickedId(tpl.id);
                        }}
                        aria-current={active ? "true" : undefined}
                        className="px-frame px-focus block w-60 text-left lg:w-full"
                        style={{ "--frame": `var(--frame-${active ? "gold-card" : "card"})` } as CSSProperties}
                      >
                        <TemplatePreview character={tpl} compact />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <PixelButton variant="accent" size="sm" icon="plus" onClick={create} className="mt-3 w-full">
                {t("library.createNew")}
              </PixelButton>
            </aside>

            {selected && (
              <section aria-label={t("library.editingOriginal")} className="min-w-0">
                {status && (
                  <p role="status" className="mb-4 bg-butter-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-butter-lo)]">
                    {status}
                  </p>
                )}
                <div className="mb-5 flex flex-col gap-3 bg-lavender-hi px-3 py-3 shadow-[inset_0_0_0_2px_var(--color-lavender)]" data-original-editor>
                  <div>
                    <p className="flex items-center gap-2 font-label text-xs uppercase tracking-wide text-label">
                      <PixelIcon name="book" size={11} /> {t("library.editingOriginal")}
                    </p>
                    <p className="mt-1 text-base leading-snug text-ink-soft">{t("library.originalEditNote")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {worldName ? (
                      <PixelButton size="sm" variant="primary" icon="plus" onClick={addToWorld}>
                        <span className="block max-w-[16rem] truncate">{t("library.addToWorld", { world: worldName })}</span>
                      </PixelButton>
                    ) : (
                      <p className="text-sm text-ink-soft">{t("library.noWorld")}</p>
                    )}
                    <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)} className="text-coral-deep">
                      {t("library.delete")}
                    </PixelButton>
                  </div>
                </div>
                <CharacterEditor key={selected.id} library character={selected} tab={tab} onTab={setTab} onChange={(patch) => libraryActions.update(selected.id, patch)} />
              </section>
            )}
          </div>
        )}
      </main>

      <ActionBar>
        <PixelLink href="/" variant="ghost" icon="left">
          {t("common.title")}
        </PixelLink>
        {activeWorld && (
          <PixelLink href="/studio" variant="primary" icon="user">
            {t("nav.cast")}
          </PixelLink>
        )}
      </ActionBar>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("library.deleteTitle")}
        closeLabel={t("common.close")}
        size="sm"
        footer={
          <>
            <PixelButton variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t("common.keep")}
            </PixelButton>
            <PixelButton variant="danger" size="sm" icon="trash" onClick={remove}>
              {t("library.deleteConfirm")}
            </PixelButton>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-lg leading-snug">
          <p>{t("library.deleteBody", { name })}</p>
          <p className="flex items-start gap-2 text-ink-soft">
            <PixelIcon name="check" size={12} className="mt-1.5 shrink-0 text-mint-deep" />
            {t("library.deleteSafe", { name })}
          </p>
        </div>
      </Modal>
    </>
  );
}
