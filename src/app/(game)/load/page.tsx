"use client";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ArtImage } from "@/components/ui/ArtImage";
import { Panel } from "@/components/ui/Panel";
import { PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { worldArt } from "@/assets/manifest";
import { getEnvironmentType } from "@/lib/environments";
import { nextStepFor, useSave } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import { getWorld } from "@/lib/worlds";

export default function LoadGamePage() {
  const hydrated = useHydrated();
  const save = useSave();
  const world = getWorld(save.worldId);
  const hasSave = Boolean(save.updatedAt);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <ScreenHeader kicker="Load game" title="Save file">
        Your game is saved in this browser automatically.
      </ScreenHeader>

      {!hydrated ? (
        <p className="font-display text-[10px] uppercase text-paper-dim">Loading save...</p>
      ) : !hasSave ? (
        <Panel className="flex flex-col items-center gap-5 px-6 py-12 text-center">
          <PixelIcon name="load" size={40} className="text-ink-400" />
          <h2 className="font-display text-sm uppercase">No save data</h2>
          <p className="text-lg text-paper-dim">Start a new game to create your first save.</p>
          <div className="flex flex-wrap justify-center gap-5">
            <PixelLink href="/" variant="ghost" icon="left">
              Title
            </PixelLink>
            <PixelLink href="/worlds" variant="primary" icon="play">
              New game
            </PixelLink>
          </div>
        </Panel>
      ) : (
        <Panel title="Slot 1" frame={world?.accent ?? "var(--color-ink-400)"}>
          <div className="flex flex-col gap-5 p-5 sm:flex-row">
            <div className="w-full shrink-0 sm:w-56">
              {world ? (
                <ArtImage art={worldArt[world.id]} alt={`${world.name} illustration`} className="aspect-[8/5] border-4 border-ink-950" />
              ) : (
                <div className="px-checker flex aspect-[8/5] items-center justify-center border-4 border-ink-950 font-display text-[9px] uppercase text-paper-dim">
                  No world
                </div>
              )}
            </div>
            <dl className="grid flex-1 grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3 text-lg">
              <dt className="font-display text-[9px] uppercase text-twist">World</dt>
              <dd style={{ color: world?.accent }}>{world?.name ?? "Not chosen"}</dd>
              <dt className="font-display text-[9px] uppercase text-twist">Cast</dt>
              <dd>
                {save.characters.length} character{save.characters.length === 1 ? "" : "s"}
              </dd>
              <dt className="font-display text-[9px] uppercase text-twist">Setting</dt>
              <dd>{getEnvironmentType(save.environment.type).name}</dd>
              <dt className="font-display text-[9px] uppercase text-twist">Saved</dt>
              <dd>{new Date(save.updatedAt!).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd>
            </dl>
          </div>
          <div className="flex flex-wrap justify-between gap-5 border-t-4 border-ink-950 p-5">
            <PixelLink href="/" variant="ghost" icon="left">
              Title
            </PixelLink>
            <PixelLink href={nextStepFor(save)} variant="primary" icon="play">
              Continue
            </PixelLink>
          </div>
        </Panel>
      )}
    </main>
  );
}
