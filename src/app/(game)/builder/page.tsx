"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { RoomViewport } from "@/components/game/RoomViewport";
import { ArtImage } from "@/components/ui/ArtImage";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { environmentArt } from "@/assets/manifest";
import { ENVIRONMENT_TYPES } from "@/lib/environments";
import { gameActions, useSave } from "@/lib/gameStore";
import { activeMapGenerator, type MapPreview } from "@/lib/mapGenerator";
import { getWorld } from "@/lib/worlds";

export default function WorldBuilderPage() {
  const router = useRouter();
  const save = useSave();
  const world = getWorld(save.worldId);
  const { description, type } = save.environment;
  const [preview, setPreview] = useState<MapPreview | null>(null);

  // Ask the (currently placeholder) map generator for a preview whenever the inputs change.
  useEffect(() => {
    let cancelled = false;
    activeMapGenerator.generate({ worldId: save.worldId, type, description }).then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [save.worldId, type, description]);

  return (
    <>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 sm:px-6">
        <ScreenHeader kicker="Step 3 · World builder" title="Set the scene">
          Describe where your story begins and pick a type of place. The preview shows placeholder art for now.
        </ScreenHeader>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
          <div className="flex flex-col gap-8">
            <Panel title="Description">
              <div className="p-5">
                <Field
                  label="Describe the environment"
                  multiline
                  rows={5}
                  maxLength={600}
                  value={description}
                  onChange={(v) => gameActions.updateEnvironment({ description: v })}
                  placeholder="A cramped bookshop above a noodle stand. It always smells like rain, and the back door is locked from the inside..."
                  hint="Saved automatically. Later, this text will drive AI map generation."
                />
              </div>
            </Panel>

            <Panel title="Environment type">
              <div role="radiogroup" aria-label="Environment type" className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {ENVIRONMENT_TYPES.map((env) => {
                  const active = env.id === type;
                  return (
                    <button
                      key={env.id}
                      role="radio"
                      aria-checked={active}
                      title={env.hint}
                      onClick={() => gameActions.updateEnvironment({ type: env.id })}
                      className="px-frame px-focus flex flex-col text-left transition-transform duration-100 hover:-translate-y-0.5"
                      style={
                        {
                          "--frame": active ? "var(--color-sun)" : "var(--color-ink-600)",
                          background: active ? "var(--color-ink-700)" : "var(--color-ink-900)",
                        } as React.CSSProperties
                      }
                    >
                      <ArtImage art={environmentArt[env.id]} alt="" showTag={false} className="aspect-[8/5] border-b-4 border-ink-950" />
                      <span className={`px-2 py-2 font-display text-[9px] uppercase leading-snug ${active ? "text-sun" : "text-paper"}`}>{env.name}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <Panel title="Preview" titleRight={<span className="font-display text-[8px] uppercase text-paper-dim">{preview?.source ?? "..."}</span>}>
              <div className="flex flex-col gap-4 p-5">
                {preview && (
                  <RoomViewport art={preview.art} label={`${preview.title} preview`} accent={world?.accent}>
                    <span className="absolute left-2 top-2 bg-ink-950/85 px-2 py-1 font-display text-[8px] uppercase text-paper">{preview.title}</span>
                  </RoomViewport>
                )}
                <p className="min-h-12 text-lg leading-snug text-paper-dim">
                  {description.trim() ? `“${description.trim()}”` : "No description yet. Your words will appear here."}
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </main>

      <ActionBar>
        <PixelLink href="/studio" variant="ghost" icon="left">
          Cast
        </PixelLink>
        <PixelButton variant="primary" icon="play" onClick={() => router.push("/play")}>
          Play
        </PixelButton>
      </ActionBar>
    </>
  );
}
