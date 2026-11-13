"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { CharacterEditor } from "@/components/game/CharacterEditor";
import { CharacterRoster } from "@/components/game/CharacterRoster";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { gameActions, useSave } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import { getWorld } from "@/lib/worlds";

export default function CharacterStudioPage() {
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 sm:px-6">
        <ScreenHeader kicker="Step 2 · Character studio" title="Assemble your cast">
          {world ? (
            <>
              Your story takes place in <span style={{ color: world.accent }}>{world.name}</span>. Everything saves automatically in this browser.
            </>
          ) : (
            "Everything saves automatically in this browser."
          )}
        </ScreenHeader>

        {!hydrated ? (
          <p className="font-display text-[10px] uppercase text-paper-dim">Loading save...</p>
        ) : save.characters.length === 0 ? (
          <Panel className="mx-auto flex max-w-xl flex-col items-center gap-5 px-6 py-12 text-center">
            <PixelIcon name="user" size={40} className="text-sun animate-bob" />
            <h2 className="font-display text-sm uppercase">No characters yet</h2>
            <p className="text-lg text-paper-dim">Create your first original character. Who are they, and what are they hiding?</p>
            <PixelButton variant="primary" icon="plus" onClick={add}>
              Create character
            </PixelButton>
          </Panel>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <p className="mb-3 font-display text-[10px] uppercase text-paper-dim">Cast · {save.characters.length}</p>
              <CharacterRoster characters={save.characters} selectedId={selected?.id ?? null} onSelect={setPickedId} onAdd={add} />
            </aside>
            {selected && (
              <section aria-label={`Editing ${selected.name || "unnamed character"}`}>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                  <p className="flex items-center gap-2 font-display text-[10px] uppercase text-mint" aria-live="polite">
                    <PixelIcon name="check" size={12} /> Autosaved
                  </p>
                  <PixelButton variant="danger" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                    Delete
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
          Worlds
        </PixelLink>
        <PixelButton variant="primary" iconRight="right" disabled={save.characters.length === 0} onClick={() => router.push("/builder")}>
          Build world
        </PixelButton>
      </ActionBar>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete character?"
        size="sm"
        footer={
          <>
            <PixelButton variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Keep
            </PixelButton>
            <PixelButton variant="primary" size="sm" icon="trash" onClick={remove}>
              Delete
            </PixelButton>
          </>
        }
      >
        <p className="text-lg">
          <span className="text-sun">{selected?.name.trim() || "This character"}</span> will be gone for good. This can&apos;t be undone.
        </p>
      </Modal>
    </>
  );
}
