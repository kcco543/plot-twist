"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CharacterInfoPanel } from "@/components/game/CharacterInfoPanel";
import { DialoguePanel } from "@/components/game/DialoguePanel";
import { RoomViewport } from "@/components/game/RoomViewport";
import { SceneSprites } from "@/components/game/SceneSprites";
import { SettingsModal } from "@/components/SettingsModal";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { environmentArt } from "@/assets/manifest";
import { getEnvironmentType } from "@/lib/environments";
import { gameActions, useSave } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import { demoCast, lineFor, type Action } from "@/lib/scenes";
import { TEXT_SPEED_MS, useSettings } from "@/lib/settingsStore";
import { getWorld } from "@/lib/worlds";

export default function PlayPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const save = useSave();
  const settings = useSettings();
  const world = getWorld(save.worldId);
  const env = getEnvironmentType(save.environment.type);

  const isDemo = save.characters.length === 0;
  const cast = useMemo(() => (isDemo ? demoCast() : save.characters), [isDemo, save.characters]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected = cast.find((c) => c.id === pickedId) ?? cast[0] ?? null;

  const place = env.name.toLowerCase();
  const intro = {
    speaker: "Narrator",
    text: save.environment.description.trim() || `The ${place} is quiet. Too quiet. Pick someone and see what happens.`,
  };
  const [line, setLine] = useState(intro);
  const turn = useRef(0);

  const [logOpen, setLogOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const act = (action: Action) => {
    if (!selected) return;
    const next = lineFor(action, selected, turn.current++, place);
    setLine(next);
    gameActions.appendLog(next);
  };

  if (!hydrated) {
    return <p className="p-10 text-center font-display text-[10px] uppercase text-paper-dim">Loading save...</p>;
  }

  if (!world) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-16">
        <Panel className="flex w-full flex-col items-center gap-5 px-6 py-12 text-center">
          <PixelIcon name="map" size={40} className="text-sun" />
          <h1 className="font-display text-sm uppercase">No world chosen</h1>
          <p className="text-lg text-paper-dim">Every story needs somewhere to happen. Pick a world first.</p>
          <PixelLink href="/worlds" variant="primary" icon="map">
            Choose world
          </PixelLink>
        </Panel>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      {/* HUD bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-[9px] uppercase" style={{ color: world.accent }}>
            {world.name}
          </p>
          <h1 className="mt-2 truncate font-display text-sm uppercase sm:text-base">{env.name}</h1>
        </div>
        <div className="flex gap-4">
          <PixelButton size="sm" icon="book" onClick={() => setLogOpen(true)}>
            Story log
            <span className="ml-1 bg-ink-950 px-1.5 py-0.5 text-[8px] text-sun">{save.log.length}</span>
          </PixelButton>
          <PixelButton size="sm" variant="primary" icon="pause" onClick={() => setPauseOpen(true)} aria-label="Pause menu">
            <span className="hidden sm:inline">Pause</span>
          </PixelButton>
        </div>
      </div>

      {isDemo && (
        <p className="mb-6 flex items-center gap-2 border-l-4 border-sun bg-ink-800 px-3 py-2 text-base text-paper-dim">
          <PixelIcon name="star" size={12} className="text-sun" />
          You haven&apos;t created anyone yet, so a demo cast is standing in.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-8">
          <RoomViewport art={environmentArt[save.environment.type]} label={`${env.name} in ${world.name}`} accent={world.accent}>
            <SceneSprites characters={cast} selectedId={selected?.id ?? null} onSelect={setPickedId} />
          </RoomViewport>
          <DialoguePanel
            speaker={line.speaker}
            text={line.text}
            msPerChar={TEXT_SPEED_MS[settings.textSpeed]}
            targetName={selected ? selected.name.trim() || "Unnamed" : null}
            onAction={act}
          />
        </div>
        <CharacterInfoPanel character={selected} isDemo={isDemo} />
      </div>

      {/* Story log */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Story log"
        size="lg"
        footer={
          <>
            <PixelButton size="sm" variant="danger" icon="trash" disabled={save.log.length === 0} onClick={() => gameActions.clearLog()}>
              Clear log
            </PixelButton>
            <PixelButton size="sm" variant="accent" onClick={() => setLogOpen(false)}>
              Close
            </PixelButton>
          </>
        }
      >
        {save.log.length === 0 ? (
          <p className="text-lg text-paper-dim">Nothing has happened yet. Talk to someone.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {[...save.log].reverse().map((e) => (
              <li key={e.id} className="border-l-4 border-ink-600 pl-3">
                <p className="font-display text-[8px] uppercase text-twist">
                  {e.speaker} · {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="text-lg leading-snug">{e.text}</p>
              </li>
            ))}
          </ol>
        )}
      </Modal>

      {/* Pause menu */}
      <Modal open={pauseOpen} onClose={() => setPauseOpen(false)} title="Paused" size="sm">
        <nav className="flex flex-col gap-5 p-1" aria-label="Pause menu">
          <PixelButton variant="primary" icon="play" onClick={() => setPauseOpen(false)}>
            Resume
          </PixelButton>
          <PixelButton
            icon="gear"
            onClick={() => {
              setPauseOpen(false);
              setSettingsOpen(true);
            }}
          >
            Settings
          </PixelButton>
          <PixelButton icon="user" onClick={() => router.push("/studio")}>
            Edit cast
          </PixelButton>
          <PixelButton icon="map" onClick={() => router.push("/builder")}>
            Edit setting
          </PixelButton>
          <PixelButton variant="ghost" icon="home" onClick={() => router.push("/")}>
            Quit to title
          </PixelButton>
          <p className="text-center text-sm text-paper-dim">Progress saves automatically.</p>
        </nav>
      </Modal>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
