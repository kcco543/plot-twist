"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CharacterInfoPanel } from "@/components/game/CharacterInfoPanel";
import { ControlPad } from "@/components/game/ControlPad";
import { DialogueBox } from "@/components/game/DialogueBox";
import { PixelStage } from "@/components/game/PixelStage";
import { SceneLabels, SceneSprites } from "@/components/game/SceneSprites";
import { SettingsModal } from "@/components/SettingsModal";
import { LoadingState } from "@/components/ui/LoadingDots";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { environmentArt } from "@/assets/manifest";
import { AiRequestError, briefFor, memoryBrief, requestTurn, useAiStatus } from "@/lib/ai/client";
import { gameActions, getSave, useSave } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import { demoCast, introLine, renderLine } from "@/lib/scenes";
import { TEXT_SPEED_MS, useSettings } from "@/lib/settingsStore";
import { neutralState, plan, type Action, type Beat } from "@/lib/story/engine";
import { beatToLines } from "@/lib/story/localWriter";
import { getWorld } from "@/lib/worlds";
import type { Character, StoryLine } from "@/lib/types";
import { useI18n } from "@/i18n";

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export default function PlayPage() {
  const { t, tx, locale } = useI18n();
  const router = useRouter();
  const hydrated = useHydrated();
  const save = useSave();
  const settings = useSettings();
  const world = getWorld(save.worldId);
  const envType = save.environment.type;

  const isDemo = save.characters.length === 0;
  const cast = useMemo(() => (isDemo ? demoCast(locale) : save.characters), [isDemo, save.characters, locale]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, cast.findIndex((c) => c.id === pickedId));
  const selected = cast[selectedIndex] ?? null;

  // The current beat's lines are stored as data, so switching language re-renders built-in lines.
  const [queue, setQueue] = useState<StoryLine[]>([]);
  const [lineIndex, setLineIndex] = useState(0);
  const current = queue[lineIndex] ?? null;
  const shownLine = renderLine(current ?? introLine(save.environment.description, envType), locale);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ai = useAiStatus();
  const useAi = Boolean(ai?.text && settings.aiStory);

  const [logOpen, setLogOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const anyModal = logOpen || pauseOpen || settingsOpen || sheetOpen;

  // Keep the stage + dialogue on screen: the stage may use the window height minus the HUD and dialogue.
  const [stageMax, setStageMax] = useState<number | undefined>(undefined);
  useEffect(() => {
    const update = () => setStageMax(window.innerWidth >= 1024 ? Math.max(300, window.innerHeight - 250) : undefined);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  /** Ask the AI to word a beat. Returns null if it can't, so the built-in lines are used instead. */
  const writeWithAi = useCallback(
    async (beat: Beat, actor: Character, other: Character | null): Promise<StoryLine[] | null> => {
      if (!world) return null;
      const save = getSave();
      const recentLines = save.log.slice(-8).map((e) => renderLine(e, locale).text).filter(Boolean);
      const delta = beat.bondBefore && beat.bondAfter ? beat.bondAfter.affinity - beat.bondBefore.affinity : null;
      try {
        const out = await requestTurn({
          locale,
          world: world.id,
          place: envType,
          placeDescription: save.environment.description.slice(0, 1200),
          beat: {
            kind: beat.kind,
            type: beat.type,
            reaction: beat.reaction,
            approach: beat.approach,
            topic: beat.topic,
            outcome: beat.outcome,
            moodBefore: beat.moodBefore,
            moodAfter: beat.moodAfter,
            bondChange: delta === null ? null : delta >= 5 ? "closer" : delta <= -5 ? "further" : "same",
            recalled: beat.recalled ? memoryBrief(beat.recalled) : null,
          },
          actor: briefFor(actor),
          other: other ? briefFor(other) : null,
          bond: beat.bondAfter,
          memories: (save.story.characters[actor.id]?.memories ?? []).slice(-6).map(memoryBrief),
          recentLines: recentLines.map((l) => l.slice(0, 400)),
        });
        if (beat.memoryId && out.memoryNote) gameActions.setMemoryNote(actor.id, beat.memoryId, out.memoryNote);
        const who = (id: string): StoryLine["speaker"] => {
          const c = id === actor.id ? actor : id === other?.id ? other : null;
          return c ? { kind: "character", name: c.name.trim(), id: c.id } : { kind: "narrator" };
        };
        return out.lines.map((l) => ({ speaker: who(l.speaker), key: "custom", params: { text: l.text }, source: "ai" }));
      } catch (e) {
        setNote(t("play.aiFallback", { reason: t(`ai.errors.${e instanceof AiRequestError ? e.code : "failed"}` as "ai.errors.failed") }));
        return null;
      }
    },
    [world, envType, locale, t],
  );

  const act = useCallback(
    async (action: Action) => {
      if (!selected || !world || busy) return;
      setNote(null);
      // 1. Game rules decide what happens and update state (mood, bonds, memories).
      const { beat, story } = plan({
        story: getSave().story,
        cast,
        actorId: selected.id,
        action,
        world: world.id,
        place: envType,
        frequency: settings.eventFrequency,
      });
      gameActions.setStory(story);
      const other = beat.otherId ? (cast.find((c) => c.id === beat.otherId) ?? null) : null;
      // 2. A writer puts it into words: the AI if available, otherwise built-in templates.
      let lines: StoryLine[] | null = null;
      if (useAi) {
        setBusy(true);
        lines = await writeWithAi(beat, selected, other);
        setBusy(false);
      }
      lines ??= beatToLines(beat, cast, envType, world.id);
      setQueue(lines);
      setLineIndex(0);
      gameActions.appendLines(lines);
    },
    [selected, world, busy, cast, envType, settings.eventFrequency, useAi, writeWithAi],
  );
  const cycle = useCallback(
    (dir: 1 | -1) => {
      if (cast.length === 0) return;
      setPickedId(cast[(selectedIndex + dir + cast.length) % cast.length].id);
    },
    [cast, selectedIndex],
  );

  // Desktop keyboard controls. Ignored while typing (incl. IME composition) or when a menu is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyModal || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const onButton = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        arrowleft: () => cycle(-1),
        a: () => cycle(-1),
        arrowright: () => cycle(1),
        d: () => cycle(1),
        z: () => act("talk"),
        x: () => act("observe"),
        c: () => act("wait"),
        v: () => act("twist"),
        l: () => setLogOpen(true),
        escape: () => setPauseOpen(true),
        p: () => setPauseOpen(true),
      };
      if (!onButton) {
        map.enter = () => act("talk");
        map[" "] = () => act("talk");
      }
      if (map[k]) {
        e.preventDefault();
        map[k]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModal, act, cycle]);

  if (!hydrated) return <LoadingState label={t("common.loadingSave")} />;

  if (!world) {
    return (
      <main className="gutter mx-auto flex w-full max-w-xl flex-1 items-center py-16">
        <Panel className="w-full">
          <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
            <PixelIcon name="map" size={40} className="text-label" />
            <h1 className="font-head text-2xl font-bold">{t("play.noWorldTitle")}</h1>
            <p className="text-lg text-ink-soft">{t("play.noWorldBody")}</p>
            <PixelLink href="/worlds" variant="primary" icon="map">
              {t("play.chooseWorld")}
            </PixelLink>
          </div>
        </Panel>
      </main>
    );
  }

  const worldName = t(`worlds.list.${world.id}.name` as const);
  const envName = t(`environments.${envType}.name` as const);
  const selectedName = selected ? selected.name.trim() || t("common.unnamed") : null;

  return (
    <main className="gutter mx-auto w-full max-w-[1600px] flex-1 pt-3 sm:pt-4" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}>
      {/* HUD */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-label text-[10px] uppercase" style={{ color: world.accent }}>
            {worldName}
          </p>
          <h1 className="truncate font-head text-xl font-bold sm:text-2xl">{envName}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden font-label text-[10px] uppercase text-ink-mute md:inline" title={t("settings.aiStoryDesc")}>
            {useAi ? t("play.writer.ai") : t("play.writer.builtin")}
          </span>
          <PixelButton size="sm" variant="magic" icon="book" onClick={() => setLogOpen(true)} aria-label={t("play.storyLog")}>
            <span className="hidden min-[420px]:inline">{t("play.storyLog")}</span>
            <span className="bg-lavender-hi px-1 text-[11px] text-label tabular-nums">{save.log.length}</span>
          </PixelButton>
          <PixelButton size="sm" variant="primary" icon="pause" onClick={() => setPauseOpen(true)} aria-label={t("play.pauseMenu")} className="min-w-11">
            <span className="hidden sm:inline">{t("play.pause")}</span>
          </PixelButton>
        </div>
      </div>

      {isDemo && (
        <p className="mb-4 flex items-center gap-2 bg-butter-hi px-3 py-2 text-base text-ink-soft shadow-[inset_4px_0_0_var(--color-butter-lo)]">
          <PixelIcon name="star" size={12} className="shrink-0 text-label" />
          {t("play.demoNotice")}
        </p>
      )}

      {/* Desktop: viewport ≈78% / character sidebar ≈21%. Phones: viewport first, character sheet in a bottom drawer. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14.5rem,21%)] xl:gap-5">
        <div className="flex min-w-0 flex-col gap-3">
          <PixelStage
            art={environmentArt[world.id][envType]}
            label={t("play.viewportAlt", { place: envName, world: worldName })}
            frame={world.frame}
            tag={t("common.placeholder")}
            fit="device"
            maxHeight={stageMax}
            overlay={<SceneLabels characters={cast} selectedId={selected?.id ?? null} />}
          >
            <SceneSprites characters={cast} selectedId={selected?.id ?? null} onSelect={setPickedId} />
          </PixelStage>
          <ControlPad
            name={selectedName}
            mood={selected ? tx(`moods.${(save.story.characters[selected.id] ?? neutralState()).mood}`) : null}
            onPrev={() => cycle(-1)}
            onNext={() => cycle(1)}
            onInteract={() => act("talk")}
            onInfo={() => setSheetOpen(true)}
            disabled={cast.length === 0 || busy}
          />
          <DialogueBox
            speaker={busy ? t("scene.narrator") : shownLine.speaker}
            text={busy ? "" : shownLine.text}
            msPerChar={TEXT_SPEED_MS[settings.textSpeed]}
            targetName={selectedName}
            onAction={act}
            index={lineIndex}
            total={Math.max(1, queue.length)}
            onNext={() => setLineIndex((i) => Math.min(queue.length - 1, i + 1))}
            busy={busy}
            note={note}
          />
          <p className="hidden font-label text-[10px] uppercase text-ink-mute lg:block">{t("play.keyboardHint")}</p>
        </div>
        <div className="hidden min-w-0 lg:block">
          <div className="lg:sticky lg:top-20">
            <CharacterInfoPanel character={selected} cast={cast} story={save.story} isDemo={isDemo} />
          </div>
        </div>
      </div>

      {/* Phone / tablet character sheet */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("play.character")} closeLabel={t("play.sidebar.close")}>
        <CharacterInfoPanel character={selected} cast={cast} story={save.story} isDemo={isDemo} framed={false} />
      </Modal>

      {/* Story log */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title={t("play.storyLog")}
        closeLabel={t("common.close")}
        size="lg"
        footer={
          <>
            <PixelButton size="sm" variant="ghost" icon="trash" disabled={save.log.length === 0} onClick={() => gameActions.clearLog()}>
              {t("play.log.clear")}
            </PixelButton>
            <PixelButton size="sm" variant="accent" onClick={() => setLogOpen(false)}>
              {t("common.close")}
            </PixelButton>
          </>
        }
      >
        {save.log.length === 0 ? (
          <p className="text-lg text-ink-soft">{t("play.log.empty")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {[...save.log].reverse().map((e) => {
              const r = renderLine(e, locale);
              return (
                <li key={e.id} className="bg-well px-3 py-2 shadow-[inset_4px_0_0_var(--color-lavender)]">
                  <p className="font-label text-[10px] uppercase text-rose">
                    {r.speaker} · {new Date(e.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                    {"source" in e && e.source === "ai" && <span className="ml-1 bg-lavender-hi px-1 text-label">AI</span>}
                  </p>
                  <p className="text-lg leading-snug">{r.text}</p>
                </li>
              );
            })}
          </ol>
        )}
      </Modal>

      {/* Pause menu */}
      <Modal
        open={pauseOpen}
        onClose={() => {
          setPauseOpen(false);
          setResetDone(false);
        }} title={t("play.paused")} closeLabel={t("common.close")} size="sm">
        <nav className="flex flex-col gap-3" aria-label={t("play.pauseMenu")}>
          <PixelButton variant="primary" icon="play" onClick={() => setPauseOpen(false)} data-autofocus>
            {t("play.resume")}
          </PixelButton>
          <PixelButton
            variant="secondary"
            icon="gear"
            onClick={() => {
              setPauseOpen(false);
              setSettingsOpen(true);
            }}
          >
            {t("common.settings")}
          </PixelButton>
          <PixelButton variant="secondary" icon="user" onClick={() => router.push("/studio")}>
            {t("play.editCast")}
          </PixelButton>
          <PixelButton variant="secondary" icon="map" onClick={() => router.push("/builder")}>
            {t("play.editSetting")}
          </PixelButton>
          <PixelButton
            variant="ghost"
            icon="undo"
            onClick={() => {
              gameActions.resetStory();
              setQueue([]);
              setResetDone(true);
            }}
          >
            {t("play.resetStory")}
          </PixelButton>
          {resetDone && (
            <p role="status" className="text-center font-label text-xs uppercase text-mint-deep">
              {t("play.resetStoryDone")}
            </p>
          )}
          <PixelButton variant="ghost" icon="home" onClick={() => router.push("/")}>
            {t("play.quit")}
          </PixelButton>
          <p className="text-center text-sm text-ink-soft">{t("play.autosaveNote")}</p>
        </nav>
      </Modal>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
