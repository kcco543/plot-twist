"use client";

import { useRouter } from "next/navigation";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { WorldCard } from "@/components/game/WorldCard";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { gameActions, useSave } from "@/lib/gameStore";
import { WORLDS, getWorld } from "@/lib/worlds";

export default function WorldSelectPage() {
  const router = useRouter();
  const save = useSave();
  const selected = getWorld(save.worldId);

  return (
    <>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 sm:px-6">
        <ScreenHeader kicker="Step 1 · Choose a world" title="Where does it all go wrong?">
          Pick the world your characters live in. You can change it later.
        </ScreenHeader>
        <div role="radiogroup" aria-label="Worlds" className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-4">
          {WORLDS.map((w) => (
            <WorldCard key={w.id} world={w} selected={save.worldId === w.id} onSelect={() => gameActions.selectWorld(w.id)} />
          ))}
        </div>
      </main>
      <ActionBar>
        <PixelLink href="/" variant="ghost" icon="left">
          Title
        </PixelLink>
        <p className="order-first w-full text-center font-display text-[10px] uppercase text-paper-dim sm:order-none sm:w-auto">
          {selected ? (
            <>
              Selected: <span style={{ color: selected.accent }}>{selected.name}</span>
            </>
          ) : (
            "No world selected"
          )}
        </p>
        <PixelButton variant="primary" iconRight="right" disabled={!selected} onClick={() => router.push("/studio")}>
          Continue
        </PixelButton>
      </ActionBar>
    </>
  );
}
