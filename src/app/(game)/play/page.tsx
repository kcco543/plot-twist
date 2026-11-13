"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { gameActions, useSave } from "@/lib/gameStore";
import { useHydrated } from "@/lib/persistentStore";
import { demoCast, introLine, lineFor, renderLine, type Action } from "@/lib/scenes";
import { TEXT_SPEED_MS, useSettings } from "@/lib/settingsStore";
import { getWorld } from "@/lib/worlds";
import type { StoryLine } from "@/lib/types";
import { useI18n } from "@/i18n";

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export default function PlayPage() {
  const { t, locale } = useI18n();
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

  // The current line is stored as data, so switching language re-renders it.
  const [line, setLine] = useState<StoryLine | null>(null);
  const shownLine = renderLine(line ?? introLine(save.environment.description, envType), locale);
  const turn = useRef(0);

  const [logOpen, setLogOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const anyModal = logOpen || pauseOpen || settingsOpen;

  const act = useCallback(
    (action: Action) => {
      if (!selected) return;
      const next = lineFor(action, selected, turn.current++, envType);
      setLine(next);
      gameActions.appendLog(next);
    },
    [selected, envType],
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
    <main className="gutter mx-auto w-full max-w-6xl flex-1 pt-4 sm:pt-6" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}>
      {/* HUD */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-label text-[10px] uppercase" style={{ color: world.accent }}>
            {worldName}
          </p>
          <h1 className="truncate font-head text-xl font-bold sm:text-2xl">{envName}</h1>
        </div>
        <div className="flex shrink-0 gap-2">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <PixelStage
            art={environmentArt[world.id][envType]}
            label={t("play.viewportAlt", { place: envName, world: worldName })}
            frame={world.frame}
            tag={t("common.placeholder")}
            overlay={<SceneLabels characters={cast} selectedId={selected?.id ?? null} />}
          >
            <SceneSprites characters={cast} selectedId={selected?.id ?? null} onSelect={setPickedId} />
          </PixelStage>
          <ControlPad name={selectedName} onPrev={() => cycle(-1)} onNext={() => cycle(1)} onInteract={() => act("talk")} disabled={cast.length === 0} />
          <DialogueBox speaker={shownLine.speaker} text={shownLine.text} msPerChar={TEXT_SPEED_MS[settings.textSpeed]} targetName={selectedName} onAction={act} />
          <p className="hidden font-label text-[10px] uppercase text-ink-mute lg:block">{t("play.keyboardHint")}</p>
        </div>
        <CharacterInfoPanel character={selected} isDemo={isDemo} />
      </div>

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
                  </p>
                  <p className="text-lg leading-snug">{r.text}</p>
                </li>
              );
            })}
          </ol>
        )}
      </Modal>

      {/* Pause menu */}
      <Modal open={pauseOpen} onClose={() => setPauseOpen(false)} title={t("play.paused")} closeLabel={t("common.close")} size="sm">
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
