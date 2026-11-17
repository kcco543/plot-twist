"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CharacterInfoPanel } from "@/components/game/CharacterInfoPanel";
import { ControlPad } from "@/components/game/ControlPad";
import { DialogueBox } from "@/components/game/DialogueBox";
import { MAX_ON_STAGE } from "@/components/game/SceneSprites";
import { StageActors, StageOverlay } from "@/components/game/StageLayers";
import { StageTestPanel } from "@/components/game/StageTestPanel";
import { BehaviorDebugPanel } from "@/components/game/BehaviorDebugPanel";
import { useCharacterDrag } from "@/components/game/CharacterDrag";
import { ConversationPanel, TalkStrip } from "@/components/game/ConversationPanel";
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
import { useTypewriter } from "@/lib/useTypewriter";
import { demoCast, introLine, renderLine, setPronounLookup } from "@/lib/scenes";
import { englishPronouns } from "@/lib/character/gender";
import { TEXT_SPEED_MS, updateSettings, useSettings } from "@/lib/settingsStore";
import { neutralState, plan, type Action, type Beat } from "@/lib/story/engine";
import { beatToLines } from "@/lib/story/localWriter";
import { getWorld } from "@/lib/worlds";
import { emotionOf, fadeEmotion } from "@/lib/emotion/emotions";
import { bondBetween, choreographBeat, rngFrom, talkDistance } from "@/lib/stage/behavior";
import { useAutonomy, type AutonomyController } from "@/lib/autonomy/useAutonomy";
import { AutonomyDebug } from "@/components/game/AutonomyDebug";
import { applyDecision, behaviorBrief, buildScenario, decide, decisionLines, scenarioByKey, triggerForBeat, type BehaviorEvent, type Decision, type Rng } from "@/lib/mind";
import type { Priority } from "@/lib/stage/actions";
import { applyDevParam, useDevMode } from "@/lib/devMode";
import { RelationshipInspector } from "@/components/game/RelationshipInspector";
import { roomFor, type Point } from "@/lib/stage/room";
import { giftObject, hitObject, objectsFor, type ObjectAction } from "@/lib/stage/objects";
import { emptyAgency } from "@/lib/autonomy/types";
import { nameFromDescription } from "@/lib/scene/layout";
import { moveGift } from "@/lib/gifts/apply";
import { useReducedMotion, useStageSim } from "@/lib/stage/useStage";
import { useTalk } from "@/lib/talk/useTalk";
import { editMemory, type MemoryPatch } from "@/lib/talk/ai/apply";
import { TALKING_PHASES } from "@/lib/talk/flow";
import type { Character, StoryLine, StoryState } from "@/lib/types";
import { useI18n } from "@/i18n";
import { InteractionMenu, type InteractionKind } from "@/components/keepsakes/InteractionMenu";
import { PhotoPanel } from "@/components/keepsakes/PhotoPanel";
import { PhotoMomentCard } from "@/components/keepsakes/PhotoMomentCard";
import { usePhotoMoment } from "@/components/keepsakes/usePhotoMoment";
import { useGiftMoment } from "@/components/keepsakes/useGiftMoment";
import { GiftMomentCard, StageGifts } from "@/components/keepsakes/GiftMomentCard";
import type { SideTab } from "@/components/game/CharacterInfoPanel";
import { displaySpots, giftAutonomy, placeDisplayed } from "@/lib/gifts/apply";
import { deletePhoto, prunePhotos } from "@/lib/keepsakes/store";
import { linkedPhotoIds, unlinkPhoto } from "@/lib/photo/apply";
import { GiftCreator } from "@/components/keepsakes/GiftCreator";
import { activeWorldId } from "@/lib/saves/worldSaves";
import { useActiveScene } from "@/lib/scene/useScene";
import { SceneFronts, SceneLoading, SceneNotice } from "@/components/game/SceneLayers";
import { SceneEditor } from "@/components/game/SceneEditor";
import { WorldViewport, type ViewportApi } from "@/components/game/WorldViewport";
import { ObjectActionMenu } from "@/components/explore/ObjectActionMenu";
import { CurtainStatus, FadeCurtain, LeaveAreaDialog, ScenePicker, SceneTitleCard, type NewSceneDraft } from "@/components/explore/TravelUI";
import { WorldMarks } from "@/components/explore/WorldMarks";
import { availability, keeperOf, resolve as resolveInteraction, stateOf as objectStateOf, type InteractContext } from "@/lib/explore/interact";
import { FIRST_SCENE_ID, activeScene, addMarker, addScene, connect, linkAt, linkKindFor, neighbours, newScene, normalizeScenes, presentIn, sceneById, setObjectState, twoWayByDefault, type SceneRecord, type WorldScenes } from "@/lib/explore/scenes";
import { travel as travelScenes } from "@/lib/explore/scenes";
import { generateSceneMap, useMapStudio } from "@/lib/mapGenerator";
import { mapDisplayName, sceneForMap } from "@/lib/scene/useScene";
import { nearestFree, spawnPoints } from "@/lib/stage/path";
import { roomSize as roomSizeOf } from "@/lib/stage/room";
import { makeId } from "@/lib/id";
import { placeGift } from "@/lib/gifts/apply";
import { AiRequestError as ImageError } from "@/lib/ai/client";
import { ZOOMS, type Zoom } from "@/lib/camera/camera";
import { sideDockMin, stackDockHeight, usePlayLayout } from "@/lib/playLayout";
import { tidyLine } from "@/lib/dialogue/typewriter";
import type { WorldObject } from "@/lib/stage/objects";
import type { EnvironmentTypeId } from "@/lib/types";

type Travel = {
  phase: "confirm" | "black" | "pick" | "generating" | "arriving";
  /** Who is at the exit. */
  actorId: string;
  exitId: string;
  /** Where it leads, when it's already connected. */
  to: string | null;
  entrance: string | null;
  /** Who goes (the one at the exit always does). */
  party: string[];
  /** A plan said in dialogue led here (not the player's own command). */
  fromDialogue: boolean;
  error: string | null;
};

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
/** Ignore a second "advance" this soon after the last one (double-clicks / key bounce never skip two lines). */
const ADVANCE_GUARD_MS = 250;

/** Space kept under the play area (the page ends exactly at the window's bottom edge). */
const PAGE_BOTTOM_GAP = 12;

export default function PlayPage() {
  const { t, tx, locale } = useI18n();
  const router = useRouter();
  const hydrated = useHydrated();
  const save = useSave();
  const settings = useSettings();
  const world = getWorld(save.worldId);
  // The scene comes from the active world save's selected map (or the built-in room when there is none).
  const scene = useActiveScene(save.worldId, save.environment.type, save.environment.mapId);
  const envType = scene.place;
  const placeDescription = scene.kind === "map" ? scene.map.description : save.environment.description;
  // ---- Connected scenes of this world (explore/scenes.ts). The active scene's map is save.environment.
  const scenes = useMemo<WorldScenes>(() => save.scenes ?? normalizeScenes(undefined, save.environment), [save.scenes, save.environment]);
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const here = activeScene(scenes);
  const sceneId = here.id;
  const firstSceneId = scenes.list[0]?.id ?? FIRST_SCENE_ID;
  // The first scene keeps its old key, so positions saved before scenes existed still come back.
  const roomKey = sceneId === FIRST_SCENE_ID ? scene.key : `${sceneId}|${scene.key}`;
  const mapStudio = useMapStudio();
  const sceneLabel = useCallback(
    (sc: SceneRecord) => {
      if (sc.name.trim()) return sc.name.trim();
      const m = sc.mapId ? mapStudio.maps.find((x) => x.id === sc.mapId) : null;
      return (m ? mapDisplayName(m) : "") || t(`environments.${sc.envType}.name` as const);
    },
    [mapStudio.maps, t],
  );

  const isDemo = save.characters.length === 0;
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;
  // Only the characters in this scene are here; everyone else stays where they were.
  const baseCast = useMemo(() => (isDemo ? demoCast(locale) : presentIn(scenes, sceneId, save.characters)), [isDemo, save.characters, locale, scenes, sceneId]);
  // Behavior Debug Panel scenarios run on this stage with their own sample cast + story, never touching the save.
  const [sandbox, setSandboxState] = useState<{ key: string; cast: Character[]; story: StoryState } | null>(null);
  const sandboxRef = useRef(sandbox);
  const setSandbox = useCallback((sb: typeof sandbox) => {
    sandboxRef.current = sb;
    setSandboxState(sb);
  }, []);
  const cast = sandbox?.cast ?? baseCast;
  const story = sandbox?.story ?? save.story;
  const castRef = useRef(cast);
  castRef.current = cast;
  // Built-in English narration uses each character's chosen pronouns (unspecified: singular "they").
  useEffect(() => {
    setPronounLookup((name) => {
      const c = castRef.current.find((x) => x.name.trim() === name.trim());
      return c ? englishPronouns(c.gender) : null;
    });
    return () => setPronounLookup(null);
  }, []);
  /** Story state the rules read from / write to (the sandbox's while a debug scenario is loaded). */
  const getStory = useCallback(() => sandboxRef.current?.story ?? getSave().story, []);
  const setStoryState = useCallback(
    (next: StoryState) => {
      if (sandboxRef.current) setSandbox({ ...sandboxRef.current, story: next });
      else gameActions.setStory(next);
    },
    [setSandbox],
  );
  /** Memory inspector: the player corrects or forgets a saved memory. Forgetting a photo memory deletes its photo too. */
  const editMemoryFor = useCallback(
    (characterId: string, memoryId: string, patch: MemoryPatch | null) => {
      const photoId = patch === null ? getStory().characters[characterId]?.memories.find((m) => m.id === memoryId)?.photo?.photoId : null;
      setStoryState(editMemory(getStory(), characterId, memoryId, patch));
      const w = activeWorldId();
      if (photoId && w && !sandboxRef.current) void deletePhoto(w, photoId).catch(() => {});
    },
    [getStory, setStoryState],
  );
  /** Memory inspector: delete only the photo file; the memory (the AI's text) stays, without the link. */
  const deletePhotoFor = useCallback(
    async (photoId: string) => {
      const w = activeWorldId();
      if (sandboxRef.current || !w) return;
      await deletePhoto(w, photoId).catch(() => false);
      setStoryState(unlinkPhoto(getStory(), photoId));
    },
    [getStory, setStoryState],
  );
  const logLines = useCallback((lines: StoryLine[]) => {
    if (!sandboxRef.current) gameActions.appendLines(lines);
  }, []);
  const devMode = useDevMode();
  useEffect(() => applyDevParam(), []);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const talkRef = useRef<ReturnType<typeof useTalk> | null>(null);
  const selectedIndex = Math.max(0, cast.findIndex((c) => c.id === pickedId));
  const selected = cast[selectedIndex] ?? null;

  // The current beat's lines are stored as data, so switching language re-renders built-in lines.
  const [queue, setQueue] = useState<StoryLine[]>([]);
  /** Bumped for every new beat, so a repeated line still counts as a new line. */
  const [beatNo, setBeatNo] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const current = queue[lineIndex] ?? null;
  const rawLine = renderLine(current ?? introLine(placeDescription, envType), locale);
  // No stray blank lines (AI replies sometimes have them): the text starts at the top of the dock.
  const shownLine = { ...rawLine, text: tidyLine(rawLine.text) };
  // Lines already read in this exchange (scroll up in the dock to reread them).
  const history = queue.slice(Math.max(0, lineIndex - 8), lineIndex).map((l) => {
    const r = renderLine(l, locale);
    return { speaker: r.speaker, text: tidyLine(r.text) };
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ai = useAiStatus();
  const useAi = Boolean(ai?.text && settings.aiStory);
  /** AI conversations (walk & talk): real Claude replies, developer TEST replies, or off (built-in replies). */
  const aiTalk: "ai" | "mock" | null = !settings.aiStory ? null : ai?.text ? "ai" : ai?.talk === "mock" ? "mock" : null;

  const [logOpen, setLogOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  /** The play-area editor for the generated map in use. */
  const [areaOpen, setAreaOpen] = useState(false);
  /** Personal interactions: the Photo / Gift menu next to a character, or the window it opened. */
  const [interaction, setInteraction] = useState<{ kind: "menu" | InteractionKind; characterId: string } | null>(null);
  const menuOpen = interaction?.kind === "menu";
  /** Leaving an area: confirmation → fade to black → choose / create the destination → arrive. */
  const [travel, setTravel] = useState<Travel | null>(null);
  const travelRef = useRef(travel);
  travelRef.current = travel;
  const anyModal = logOpen || pauseOpen || settingsOpen || sheetOpen || areaOpen || (!!interaction && !menuOpen) || !!travel;
  /** The action menu next to an object (who would do it, and to what). */
  const [objMenu, setObjMenu] = useState<{ actorId: string; objectId: string } | null>(null);
  const viewportApi = useRef<ViewportApi>(null);
  const zoom: Zoom = settings.cameraZoom ?? "normal";
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const getZoom = useCallback(() => zoomRef.current, []);
  const [titleKey, setTitleKey] = useState("");

  // Play layout: viewport beside the dialogue dock ("side") or above it ("stack"), sized to the window
  // so the scene and the response choices are visible together (lib/playLayout.ts).
  const playRef = useRef<HTMLDivElement>(null);
  const layout = usePlayLayout(playRef, PAGE_BOTTOM_GAP);
  const wide = layout.shape === "side";
  const headerH = layout.headerH;
  /** Desktop: character details open in the secondary panel under the play area. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLElement>(null);

  // ---- Stage: positions, movement, emotions (Step 2). Paused with the game.
  const [frozen, setFrozen] = useState(false);
  const reducedMotion = useReducedMotion(settings.reduceMotion);
  const onStage = useMemo(() => cast.slice(0, MAX_ON_STAGE), [cast]);
  const builtinRoom = useMemo(() => roomFor(world?.id ?? "otherworld", envType), [world?.id, envType]);
  const baseRoom = scene.kind === "loading" ? builtinRoom : scene.room;
  // The scene's own objects (annotated map objects or the built-in room's) + exit markers the game added.
  const ownObjects = useMemo<WorldObject[]>(() => {
    const w = world?.id ?? "otherworld";
    const base = scene.kind === "map" ? scene.built.objects : scene.kind === "builtin" ? objectsFor(w, envType) : [];
    const { width, height } = roomSizeOf(baseRoom);
    const markers: WorldObject[] = here.markers.map((m) => {
      const x = m.at.x * width;
      const y = m.at.y * height;
      const anchor = nearestFree(baseRoom, { x, y }, [], 0, 48) ?? { x, y };
      return { id: m.id, type: "exit", name: "custom", world: "default", place: envType, bounds: { x0: anchor.x - 8, y0: anchor.y - 24, x1: anchor.x + 8, y1: anchor.y + 2 }, collider: null, anchors: [anchor], radius: 6, actions: ["leave"], tags: ["exit", "way back", "出口"], exit: true, marker: true };
    });
    // Exits know where they lead, so "I'm going to the library" finds the right door.
    return [...base, ...markers].map((o) => {
      if (!o.exit) return o;
      const l = linkAt(scenes, sceneId, o.id);
      const dest = l ? sceneById(scenes, l.to) : null;
      if (!dest) return o.marker ? { ...o, label: t("explore.marker.back") } : o;
      const name = sceneLabel(dest);
      return { ...o, tags: [...o.tags, name.toLowerCase(), ...name.toLowerCase().split(/\s+/).filter((x) => x.length > 2)], label: o.marker ? t("explore.marker.to", { scene: name }) : o.label };
    });
  }, [scene, world?.id, envType, baseRoom, here.markers, scenes, sceneId, sceneLabel, t]);
  const objectStates = here.objects;
  const objectStatesRef = useRef(objectStates);
  objectStatesRef.current = objectStates;
  // Open doors don't block the way: their collider leaves the room (the same place, so nobody is moved).
  const openColliders = ownObjects
    .filter((o) => o.type === "door" && o.collider && objectStateOf(o, objectStates[o.id]).open)
    .map((o) => o.collider!)
    .sort()
    .join("|");
  const room = useMemo(() => {
    if (!openColliders) return baseRoom;
    const open = new Set(openColliders.split("|"));
    return { ...baseRoom, obstacles: baseRoom.obstacles.filter((x) => !open.has(x.id)) };
  }, [baseRoom, openColliders]);
  const bondOf = useCallback((a: string, b: string) => bondBetween(getStory(), a, b), [getStory]);
  // Where everyone stood last time in this room (saved with the world), so a reload puts them back.
  const roomKeyRef = useRef("");
  roomKeyRef.current = roomKey;
  const savedSpots = useCallback(() => {
    const sp = getStory().agency?.spots;
    return sp && sp.place === roomKeyRef.current ? sp.at : {};
  }, [getStory]);
  const stage = useStageSim({ cast: onStage, room, roomKey, paused: anyModal || frozen, reducedMotion, bondOf, savedSpots });
  // Show each character's current emotion (story state is the source of truth; also covers loading a save).
  useEffect(() => {
    for (const c of onStage) {
      const e = emotionOf(story.characters[c.id]);
      stage.syncEmotion(c.id, e.emotion, e.level, e.at);
    }
  }, [stage, onStage, story]);

  /**
   * BEHAVIOR ENGINE: one character reacts to an event. Reads the live stage
   * (distance, who's busy, whether the player is steering them, whether the
   * other can be reached), decides, writes the result to story state, and
   * plays it through the validated stage actions. Returns the lines to show.
   */
  const decideFor = useCallback(
    (event: BehaviorEvent, rng?: Rng): Decision | null => {
      const s = getStory();
      const castNow = castRef.current;
      const me = castNow.find((c) => c.id === event.reactorId);
      if (!me) return null;
      const otherId = event.otherId;
      return decide({
        story: s,
        cast: castNow,
        event,
        place: envType,
        stage: {
          gap: otherId ? stage.gapBetween(me.id, otherId) : null,
          talkDistance: otherId ? talkDistance(me, bondBetween(s, me.id, otherId), emotionOf(s.characters[me.id]).emotion) : 32,
          state: stage.stateOf(me.id),
          commanded: stage.isCommanded(me.id),
          canReach: otherId ? stage.canReach(me.id, otherId) : true,
        },
        rng: rng ?? rngFrom(`${s.turn}:${me.id}:${event.trigger}:${Date.now()}`),
      });
    },
    [getStory, stage, envType],
  );
  /** Apply a decision: story state (feelings, relations, memory), the visible emotion and the movement. */
  const commitDecision = useCallback(
    (decision: Decision, priority: Priority = "story") => {
      const s = getStory();
      const castNow = castRef.current;
      const next = applyDecision(s, decision, castNow);
      setStoryState(next);
      const id = decision.event.reactorId;
      const e = emotionOf(next.characters[id]);
      stage.syncEmotion(id, e.emotion, e.level, e.at);
      // Walks start now: if the character's own line begins first, the walk pauses while they speak and resumes
      // afterwards (the stage's normal rule). Small gestures wait for the hesitation pause.
      for (const m of decision.movement) {
        const travels = m.action.type === "approach" || m.action.type === "retreat";
        stage.schedule(travels ? 0 : m.delay, m.action, "event", priority);
      }
      setDecisions((list) => [decision, ...list].slice(0, 12));
      return next;
    },
    [getStory, setStoryState, stage],
  );
  const behave = useCallback(
    (event: BehaviorEvent, priority: Priority, opts: { rng?: Rng; apply?: boolean } = {}): { decision: Decision; lines: StoryLine[] } | null => {
      const s = getStory();
      const decision = decideFor(event, opts.rng);
      if (!decision) return null;
      if (opts.apply === false) return { decision, lines: [] };
      const next = commitDecision(decision, priority);
      return { decision, lines: decisionLines(decision, castRef.current, (next.decisions?.length ?? 0) + s.turn) };
    },
    [getStory, decideFor, commitDecision],
  );

  // One typewriter for the current line, shared by the speech bubble and the dialogue panel.
  const lineId = `${beatNo}:${lineIndex}`;
  const typer = useTypewriter(busy ? "" : shownLine.text, TEXT_SPEED_MS[settings.textSpeed], { id: lineId, paused: anyModal });
  const more = lineIndex < queue.length - 1;
  const lastAdvance = useRef(0);
  /** Finish the typing; if it's already finished, go to the next line. One step per call. */
  const advance = useCallback(() => {
    const now = performance.now();
    if (now - lastAdvance.current < ADVANCE_GUARD_MS) return;
    lastAdvance.current = now;
    if (!typer.done) typer.skip();
    else if (more) setLineIndex((i) => Math.min(queue.length - 1, i + 1));
  }, [typer, more, queue.length]);
  const lineInProgress = !busy && (!typer.done || more);
  const lineInProgressRef = useRef(lineInProgress);
  lineInProgressRef.current = lineInProgress || busy;

  // Character autonomy is set up further down (it needs the room's objects); the talk flow reaches it through this bridge.
  const autonomyRef = useRef<AutonomyController | null>(null);
  const autonomyBridge = useMemo(
    () => ({
      refusesTalk: (l: string, sp: string) => autonomyRef.current?.refusesTalk(l, sp) ?? null,
      refused: (l: string, sp: string) => autonomyRef.current?.refused(l, sp),
      talking: (a: string, b: string) => void autonomyRef.current?.talking(a, b),
      endedConversation: (l: string, sp: string) => autonomyRef.current?.endedConversation(l, sp),
      heard: (id: string, text: string) => autonomyRef.current?.heard(id, text),
      conversationOver: (ids: string[]) => autonomyRef.current?.conversationOver(ids),
    }),
    [],
  );
  // ---- Walk-and-talk (Step 3): drag a character onto another (or tap-to-target), they walk over and talk.
  const talk = useTalk({
    stage,
    cast: onStage,
    world: world?.id ?? "otherworld",
    place: envType,
    locale,
    getStory,
    setStoryState,
    decideOnly: (event) => decideFor(event),
    commit: (d) => commitDecision(d, "story"),
    showLines: (lines) => {
      setQueue(lines);
      setBeatNo((n) => n + 1);
      setLineIndex(0);
      logLines(lines);
    },
    beatNo,
    lineIndex,
    lineInProgress: lineInProgress || busy,
    recentText: () =>
      getSave()
        .log.slice(-6)
        .map((e) => renderLine(e, locale))
        .map((r) => `${r.speaker}: ${r.text}`),
    ai: aiTalk,
    placeDescription: placeDescription,
    renderText: (line) => renderLine(line, locale).text,
    onSelect: setPickedId,
    // Ending mid-line: the unread lines go away with the conversation (no stale, half-read reply).
    onEnd: () => {
      if (lineInProgressRef.current) setQueue([]);
    },
    autonomy: autonomyBridge,
  });
  talkRef.current = talk;
  // Developer builds: expose the stage to browser tests (e.g. to put a wall in the way).
  useEffect(() => {
    if (!devMode) return;
    (window as unknown as { __plotTwistStage?: typeof stage }).__plotTwistStage = stage;
  }, [devMode, stage]);
  const talkPhase = talk.session?.phase ?? null;
  const talking = talkPhase !== null && TALKING_PHASES.includes(talkPhase);
  const blockDrag = useRef(false);
  blockDrag.current = anyModal || frozen;
  const drag = useCharacterDrag({
    stage,
    canDrag: () => !blockDrag.current && !isTyping(document.activeElement) && !talkRef.current?.session?.composing,
    distanceFor: (a, b) => {
      const s = getStory();
      const me = castRef.current.find((c) => c.id === a);
      return me ? Math.max(22, talkDistance(me, bondBetween(s, a, b), emotionOf(s.characters[a]).emotion)) : 30;
    },
    onDrop: (a, b) => talk.startWalk(a, b, "drag"),
    onDropEmpty: (a) => talk.tell("emptySpace", a, null),
    onDropObject: (a, o) => sendToRef.current(a, { objectId: o }),
    onDropGround: (a, p) => sendToRef.current(a, { point: p }),
    // Pointer → world through the camera (correct after any pan or zoom).
    toWorld: (x, y) => viewportApi.current?.toWorld(x, y) ?? null,
  });
  /** Set below, once the room's objects are known (the drag callbacks run long after render). */
  const sendToRef = useRef<(actorId: string, to: { objectId: string; action?: ObjectAction } | { point: Point }) => boolean>(() => false);
  /**
   * Click / tap on a character: select it and open the Photo / Gift menu next to it
   * (clicking them again closes it). While choosing who to talk to (tap-to-target)
   * the tap still picks the target, and during a conversation it only selects.
   * Dragging (mouse) or touch-and-hold (touch) still starts a walk & talk.
   */
  const onStageSelect = useCallback(
    (id: string) => {
      if (drag.swallowClick()) return;
      const s = talkRef.current?.session;
      if (s?.phase === "SELECT_TARGET") {
        if (id === s.actorId) talkRef.current?.cancel();
        else talkRef.current?.startWalk(s.actorId, id, "tap");
        return;
      }
      setPickedId(id);
      if (!s) setInteraction((cur) => (cur?.kind === "menu" && cur.characterId === id ? null : { kind: "menu", characterId: id }));
    },
    [drag],
  );
  // A drag or a conversation takes over: the menu gets out of the way.
  useEffect(() => {
    if (drag.dragging || talk.session) setInteraction((cur) => (cur?.kind === "menu" ? null : cur));
  }, [drag.dragging, talk.session]);
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(window.matchMedia("(pointer: coarse)").matches), []);

  /** Show a reaction's lines right away (bubble + panel). */
  const showLines = useCallback(
    (lines: StoryLine[]) => {
      if (!lines.length) return;
      setQueue(lines);
      setBeatNo((n) => n + 1);
      setLineIndex(0);
      logLines(lines);
    },
    [logLines],
  );

  // ---- Photo reactions (AI): the confirmed photo goes to the AI; the reaction plays on the stage once the Photo window closes.
  const photoMoment = usePhotoMoment({
    stage,
    cast: onStage,
    getStory,
    setStoryState,
    showLines,
    locale,
    world: world?.id ?? "otherworld",
    place: envType,
    placeDescription: placeDescription,
    worldId: !isDemo && !sandbox ? activeWorldId() : null,
    paused: anyModal,
  });
  // ---- Gifts (AI reactions + world-specific gift instances shown on the stage's display spots).
  const spots = useMemo(() => displaySpots(room), [room]);
  const sceneOfGifts = useMemo(() => ({ id: sceneId, first: firstSceneId }), [sceneId, firstSceneId]);
  const giftMoment = useGiftMoment({
    stage,
    cast: onStage,
    getStory,
    setStoryState,
    showLines,
    locale,
    world: world?.id ?? "otherworld",
    place: envType,
    placeDescription: placeDescription,
    worldId: !isDemo && !sandbox ? activeWorldId() : null,
    spots: spots.length,
    paused: anyModal,
  });
  const [infoTab, setInfoTab] = useState<{ tab: SideTab; n: number } | null>(null);

  // ---- Interactive objects (hand-annotated per room, plus gifts on display) and drag-to-place / drag-to-object.
  const objects = useMemo(() => {
    const w = world?.id ?? "otherworld";
    const group = w === "otherworld" ? "otherworld" : "default";
    return [...ownObjects, ...placeDisplayed(story, spots, sceneOfGifts).map(({ gift, spot }) => giftObject(gift, spot, room, group, envType))];
  }, [world?.id, envType, story, spots, room, ownObjects, sceneOfGifts]);
  useEffect(() => stage.setObjects(objects), [stage, objects]);
  const objectName = useCallback(
    (id: string) => {
      const o = stage.objectById(id);
      if (!o) return "";
      return o.type === "gift" ? (getStory().gifts?.[o.giftId ?? ""]?.name ?? t("objects.names.gift")) : (o.label ?? t(`objects.names.${o.name}` as "objects.names.door"));
    },
    [stage, getStory, t],
  );
  // ---- Character autonomy: characters act on their own (rules, not AI), keep their distance after a
  // conversation ends, and follow through on plans they said out loud. Off in the demo and debug scenarios.
  const autonomy = useAutonomy({
    stage,
    cast: onStage,
    objects,
    roomKey,
    getStory,
    setStoryState,
    enabled: !isDemo && !sandbox && !anyModal && !frozen,
    inConversation: (id) => !!talkRef.current?.session && (talkRef.current.session.actorId === id || talkRef.current.session.targetId === id),
    notify: (kind, actorId, other) => talk.tellNames(kind, castRef.current.find((c) => c.id === actorId)?.name.trim() ?? "", other),
    objectName,
    nameOf: (id) => castRef.current.find((c) => c.id === id)?.name.trim() ?? "",
  });
  autonomyRef.current = autonomy;
  // ---- Object interactions (explore/interact.ts): what can be done right now, and what doing it really does.
  const objectState = useCallback((o: WorldObject) => objectStateOf(o, objectStatesRef.current[o.id]), []);
  const interactCtx = useCallback(
    (actorId: string, o: WorldObject, priority: Priority): InteractContext => {
      const l = o.exit ? linkAt(scenesRef.current, scenesRef.current.active, o.id) : null;
      const dest = l ? sceneById(scenesRef.current, l.to) : null;
      return {
        actorId,
        carrying: Object.values(getStory().gifts ?? {})
          .filter((g) => g.owner === actorId && g.display === "carried")
          .map((g) => ({ id: g.id, name: g.name })),
        keeperId: keeperOf(o, stage.getSnapshot().actors, actorId),
        destination: dest ? sceneLabel(dest) : null,
        priority,
      };
    },
    [getStory, stage, sceneLabel],
  );
  const actionsFor = useCallback((actorId: string, o: WorldObject) => availability(o, objectState(o), interactCtx(actorId, o, "player")), [objectState, interactCtx]);
  // The stage only accepts object actions that make sense in the object's current state (a locked door can't be opened).
  useEffect(() => {
    stage.objectGuard = (actor, o, action) => {
      if (o.type === "gift") return true;
      return !!actionsFor(actor, o).find((a) => a.action === action && a.ok);
    };
    return () => {
      stage.objectGuard = null;
    };
  }, [stage, actionsFor]);
  /** Save a change to an object's state in this scene (doors, chests). */
  const patchObjectState = useCallback((objectId: string, patch: Partial<import("@/lib/explore/interact").ObjectState>) => {
    const sc = getSave().scenes ?? normalizeScenes(undefined, getSave().environment);
    gameActions.setScenes(setObjectState(sc, sc.active, objectId, patch));
  }, []);

  /** Player command: walk to a floor spot or to an object (never a conversation). Returns false with a notice when impossible. */
  sendToRef.current = (actorId, to) => {
    const s = talkRef.current?.session;
    if (s && (s.actorId === actorId || s.targetId === actorId)) talkRef.current?.cancel();
    const who = castRef.current.find((c) => c.id === actorId)?.name.trim() ?? "";
    setPickedId(actorId);
    if ("objectId" in to) {
      const o = stage.objectById(to.objectId);
      if (!o) return false;
      let action = to.action;
      if (!action && o.type !== "gift") {
        // Several things to do here: ask with the compact menu instead of guessing.
        const list = actionsFor(actorId, o);
        const ok = list.filter((a) => a.ok);
        if (list.length > 1) {
          setObjMenu({ actorId, objectId: o.id });
          return true;
        }
        if (!ok.length) {
          const blocked = list[0];
          talk.tellNames("unreachableObject", who, blocked && !blocked.ok ? `${objectName(o.id)} (${t(`explore.unavailable.${blocked.reason}`)})` : objectName(o.id));
          return false;
        }
        action = ok[0].action;
      }
      const r = stage.request({ type: "use_object", actor: actorId, object: to.objectId, ...(action ? { action } : {}) }, "test", "player");
      if (!r.ok) talk.tellNames(r.reason === "busy" ? "busy" : "unreachableObject", who, objectName(to.objectId));
      return r.ok;
    }
    const r = stage.request({ type: "walk_to", actor: actorId, x: Math.round(to.point.x), y: Math.round(to.point.y) }, "test", "player");
    if (!r.ok) talk.tellNames(r.reason === "busy" ? "busy" : "unreachablePlace", who, "");
    else if (r.note === "nearby") talk.tellNames("nearby", who, "");
    return r.ok;
  };
  const proposeExitRef = useRef<(actorId: string, objectId: string, fromDialogue: boolean) => void>(() => {});
  /**
   * Someone reached an object and used it. Game rules decide what actually
   * happened (door opened / locked, stairs climbed, bartender called over),
   * the object's state is saved, and the character animates, sits, talks or
   * is offered the way out. Only the player's commands and genuine plans from
   * dialogue can lead out of the scene; autonomous habits never do.
   */
  useEffect(() => {
    stage.onObject = (actorId: string, objectId: string, action: ObjectAction, priority: Priority) => {
      const o = stage.objectById(objectId);
      const me = castRef.current.find((c) => c.id === actorId);
      if (!o || !me) return;
      const say = (line: StoryLine) => (lineInProgressRef.current ? logLines([line]) : showLines([line]));
      if (o.type === "gift") {
        if (action === "pick_up" && o.giftId && o.ownerId === actorId) setStoryState(moveGift(getStory(), o.giftId, "carried", "picked_up", [actorId]));
        say({ speaker: { kind: "narrator" }, key: "tpl", tpl: `objects.do.${action}`, params: { name: me.name.trim(), object: objectName(objectId) }, source: "builtin" });
        return;
      }
      const ctx = interactCtx(actorId, o, priority);
      const out = resolveInteraction(o, action, objectState(o), ctx);
      if (out.patch && !sandboxRef.current) patchObjectState(o.id, out.patch);
      if (out.anim) stage.perform(actorId, out.anim, out.anim === "climb" ? 900 : 700);
      if (out.pose !== undefined) stage.setPose(actorId, out.pose);
      const keeper = ctx.keeperId ? (castRef.current.find((c) => c.id === ctx.keeperId)?.name.trim() ?? "") : "";
      say({ speaker: { kind: "narrator" }, key: "tpl", tpl: out.line.tpl, params: { name: me.name.trim(), object: objectName(objectId), other: keeper, ...(out.line.params ?? {}) }, source: "builtin" });
      const f = out.follow;
      if (!f) return;
      if (f.kind === "talk" && priority === "player") window.setTimeout(() => talkRef.current?.talkHere(actorId, f.target, "drag"), 650);
      else if (f.kind === "exit" && priority !== "auto" && !sandboxRef.current && !isDemoRef.current) window.setTimeout(() => proposeExitRef.current(actorId, o.id, priority !== "player"), out.anim === "climb" ? 700 : 450);
      else if (f.kind === "place" && !sandboxRef.current) setStoryState(placeGift(getStory(), f.itemId, scenesRef.current.active, o.collider, castRef.current.map((c) => c.id)));
    };
    return () => {
      stage.onObject = null;
    };
  }, [stage, objectName, getStory, setStoryState, logLines, showLines, interactCtx, objectState, patchObjectState]);
  // ---- Leaving an area (explore/scenes.ts): confirm → fade to black → destination → arrive at its entrance.
  const fadeMs = reducedMotion ? 0 : 420;
  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;
  proposeExitRef.current = (actorId, objectId, fromDialogue) => {
    if (travelRef.current) return;
    const l = linkAt(scenesRef.current, scenesRef.current.active, objectId);
    setObjMenu(null);
    setInteraction(null);
    setTravel({ phase: "confirm", actorId, exitId: objectId, to: l?.to ?? null, entrance: l?.entrance ?? null, party: [actorId], fromDialogue, error: null });
  };
  const currentScenes = useCallback(() => getSave().scenes ?? normalizeScenes(undefined, getSave().environment), []);
  /** The key Play will use for a scene's room (so positions saved for it come back). */
  const roomKeyFor = useCallback((sc: SceneRecord) => {
    const base = sc.mapId ? `map:${sc.mapId}` : `${world?.id ?? "otherworld"}:${sc.envType}`;
    return sc.id === FIRST_SCENE_ID ? base : `${sc.id}|${base}`;
  }, [world?.id]);
  const arrivalRef = useRef<{ sceneId: string; entrance: string | null; travellers: string[]; at: number } | null>(null);
  const failTravel = useCallback(
    (sceneName: string) => {
      setTravel(null);
      logLines([{ speaker: { kind: "narrator" }, key: "tpl", tpl: "explore.travel.failed", params: { scene: sceneName } }]);
      setNote(t("explore.travel.failed", { scene: sceneName }));
    },
    [logLines, t],
  );
  /** Move the travellers into `destId` (saving this scene first) and switch the view there. */
  const arriveAt = useCallback(
    (destId: string, entrance: string | null, tv: Travel, sc: WorldScenes = currentScenes()) => {
      const s = getSave();
      const fromName = sceneLabel(activeScene(sc));
      const r = travelScenes(sc, { to: destId, travellers: tv.party, leftSpots: stage.spots(), env: s.environment, presentIds: onStageRef.current.map((c) => c.id) });
      const dest = r ? sceneById(r.scenes, destId) : null;
      if (!r || !dest) return failTravel(sceneById(sc, destId) ? sceneLabel(sceneById(sc, destId)!) : "?");
      const story = getStory();
      const agency = { ...emptyAgency(), ...(story.agency ?? {}), spots: { place: roomKeyFor(dest), at: dest.spots } };
      arrivalRef.current = { sceneId: destId, entrance, travellers: tv.party, at: performance.now() };
      gameActions.setScenesAndStory(r.scenes, { ...story, agency }, r.env);
      setTravel({ ...tv, phase: "arriving", to: destId, entrance });
      const names = tv.party.map((id) => castRef.current.find((c) => c.id === id)?.name.trim() ?? "").filter(Boolean).join(locale === "zh-CN" ? "、" : ", ");
      logLines([{ speaker: { kind: "narrator" }, key: "tpl", tpl: "explore.travel.log", params: { names, from: fromName, to: sceneLabel(dest) } }]);
    },
    [currentScenes, getStory, stage, failTravel, roomKeyFor, sceneLabel, logLines, locale],
  );
  /** A destination's room and objects, to find where travellers arrive (an exit of the same kind, or a new marker). */
  const destLayout = useCallback(
    (dest: SceneRecord, fresh?: { id: string } & Parameters<typeof sceneForMap>[0]) => {
      const w = world?.id ?? "otherworld";
      const m = fresh && fresh.id === dest.mapId ? fresh : dest.mapId ? mapStudio.maps.find((x) => x.id === dest.mapId) : null;
      if (m) {
        const sc = sceneForMap(m);
        return { room: sc.room, objects: sc.built.objects };
      }
      return { room: roomFor(w, dest.envType), objects: objectsFor(w, dest.envType) };
    },
    [world?.id, mapStudio.maps],
  );
  /** Connect the exit being used to `destId` (and a way back, if asked). */
  const linkExit = useCallback(
    (sc: WorldScenes, tv: Travel, destId: string, twoWay: boolean, fresh?: Parameters<typeof destLayout>[1]): { scenes: WorldScenes; entrance: string | null } | null => {
      const exitObj = stage.objectById(tv.exitId);
      const kind = linkKindFor(exitObj?.type ?? "exit");
      const dest = sceneById(sc, destId);
      if (!dest) return null;
      const info = destLayout(dest, fresh);
      let next = sc;
      // The natural way back: an exit of the same kind over there that leads nowhere yet (stairs ↔ stairs, door ↔ door).
      const free = info.objects.find((o) => o.exit && linkKindFor(o.type) === kind && !linkAt(sc, destId, o.id));
      let entrance: string | null = free?.id ?? null;
      if (!free && twoWay) {
        const sp = spawnPoints(info.room, 1)[0];
        const size = roomSizeOf(info.room);
        entrance = makeId("exit");
        next = addMarker(next, destId, { id: entrance, kind, at: { x: sp.x / size.width, y: sp.y / size.height } });
      }
      const res = connect(next, { id: makeId("link"), from: sc.active, fromExit: tv.exitId, to: destId, toEntrance: entrance, kind, twoWay, createdAt: Date.now() });
      return res.ok ? { scenes: res.scenes, entrance } : null;
    },
    [stage, destLayout],
  );
  const leaveNow = useCallback(() => {
    const tv = travelRef.current;
    if (!tv) return;
    setTravel({ ...tv, phase: "black" });
    window.setTimeout(() => {
      const cur = travelRef.current;
      if (!cur || cur.phase !== "black") return;
      if (cur.to && sceneById(currentScenes(), cur.to)) arriveAt(cur.to, cur.entrance, cur);
      else setTravel({ ...cur, phase: "pick" });
    }, fadeMs);
  }, [arriveAt, currentScenes, fadeMs]);
  const stayHere = useCallback(() => {
    const tv = travelRef.current;
    setTravel(null);
    if (!tv) return;
    const who = castRef.current.find((c) => c.id === tv.actorId)?.name.trim() ?? "";
    logLines([{ speaker: { kind: "narrator" }, key: "tpl", tpl: "explore.travel.stayed", params: { name: who, exit: objectName(tv.exitId) } }]);
  }, [logLines, objectName]);
  const chooseScene = useCallback(
    (destId: string, twoWay: boolean) => {
      const tv = travelRef.current;
      if (!tv) return;
      const r = linkExit(currentScenes(), tv, destId, twoWay);
      if (!r) return failTravel("?");
      arriveAt(destId, r.entrance, tv, r.scenes);
    },
    [linkExit, currentScenes, arriveAt, failTravel],
  );
  const createScene = useCallback(
    async (d: NewSceneDraft, how: "generate" | "placeholder", twoWay: boolean) => {
      const tv = travelRef.current;
      if (!tv || !world) return;
      let map: Awaited<ReturnType<typeof generateSceneMap>> | null = null;
      if (how === "generate") {
        setTravel({ ...tv, phase: "generating", error: null });
        try {
          map = await generateSceneMap({ worldId: world.id, type: d.envType, description: d.description });
        } catch (e) {
          // Generation failed: nothing changes, the player can retry, use a placeholder, or cancel.
          if (travelRef.current?.phase === "generating") setTravel({ ...tv, phase: "pick", error: t(`ai.errors.${e instanceof ImageError ? e.code : "failed"}` as "ai.errors.failed") });
          return;
        }
        if (travelRef.current?.phase !== "generating") return;
      }
      const id = makeId("scene");
      const rec = newScene({ id, name: d.name.trim() || nameFromDescription(d.description), description: d.description.trim(), envType: d.envType, mapId: map?.id ?? null, placeholder: !map });
      const sc = addScene(currentScenes(), rec);
      if (!sceneById(sc, id)) return setTravel({ ...tv, phase: "pick", error: t("explore.picker.full") });
      const r = linkExit(sc, tv, id, twoWay, map ?? undefined);
      if (!r) return failTravel(rec.name);
      arriveAt(id, r.entrance, tv, r.scenes);
    },
    [world, currentScenes, linkExit, arriveAt, failTravel, t],
  );
  // Arrival: once the destination's map is ready, the travellers appear at its entrance and the curtain lifts.
  useEffect(() => {
    const a = arrivalRef.current;
    if (!travel || travel.phase !== "arriving" || !a) return;
    const ready = scene.kind !== "loading" && sceneId === a.sceneId;
    const late = performance.now() - a.at > 6000;
    if (!ready && !late) {
      const id = window.setTimeout(() => setTravel((tv) => (tv ? { ...tv } : tv)), 500);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      const ent = a.entrance ? ownObjects.find((o) => o.id === a.entrance) : null;
      const at = ent?.anchors[0];
      if (at) for (const cid of a.travellers) stage.spawnAt(cid, at);
      arrivalRef.current = null;
      setPickedId(travel.actorId);
      setTravel(null);
      setTitleKey(`${a.sceneId}:${Date.now()}`);
    }, 80);
    return () => window.clearTimeout(id);
  }, [travel, scene.kind, sceneId, ownObjects, stage]);
  // Gifts that become displayed while the player is here belong to this scene.
  const shownGifts = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set(Object.values(save.story.gifts ?? {}).filter((g) => g.display === "displayed").map((g) => g.id));
    const before = shownGifts.current;
    shownGifts.current = now;
    if (!before || sandbox) return;
    const fresh = [...now].filter((id) => !before.has(id) && !save.story.gifts?.[id]?.sceneId);
    if (!fresh.length) return;
    const st = getStory();
    setStoryState({ ...st, gifts: Object.fromEntries(Object.entries(st.gifts ?? {}).map(([id, g]) => [id, fresh.includes(id) ? { ...g, sceneId } : g])) });
  }, [save.story.gifts, sandbox, sceneId, getStory, setStoryState]);

  /** Tap / click on the map: an object opens its action menu for the selected character. */
  const onMapTap = useCallback(
    (p: Point) => {
      if (drag.swallowClick()) return;
      setInteraction((cur) => (cur?.kind === "menu" ? null : cur));
      const o = hitObject(stage.objects, p, touch ? 4 : 2);
      const actor = selected?.id;
      if (!o || !actor || talkRef.current?.session) return setObjMenu(null);
      if (o.type === "gift") return sendToRef.current(actor, { objectId: o.id });
      setObjMenu({ actorId: actor, objectId: o.id });
    },
    [drag, stage, selected?.id, touch],
  );
  /** What dropping a character on this object will do (shown while dragging). */
  const objectHint = useCallback(
    (actorId: string, o: WorldObject) => {
      if (o.type === "gift") return null;
      const list = actionsFor(actorId, o);
      const ok = list.filter((a) => a.ok);
      const name = objectName(o.id);
      if (list.length > 1) return { label: t("explore.drag.choose", { object: name }), ok: ok.length > 0 };
      if (ok.length) return { label: t("objects.drag.use", { action: t(`objects.actions.${ok[0].action}`), object: name }), ok: true };
      const b = list[0];
      return b && !b.ok ? { label: t("explore.drag.blocked", { reason: t(`explore.unavailable.${b.reason}`), object: name }), ok: false } : null;
    },
    [actionsFor, objectName, t],
  );

  // Characters handle their gifts by plain rules, once per story turn (never every frame, never AI).
  // The first turn seen after the save loads is only remembered: opening or reloading a world moves nothing.
  const giftTurn = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated || sandbox || isDemo) return;
    const first = giftTurn.current === null;
    if (save.story.turn === giftTurn.current) return;
    giftTurn.current = save.story.turn;
    if (first) return;
    const r = giftAutonomy(getStory(), onStage, spots.length);
    if (!r.moves.length) return;
    setStoryState(r.story);
    logLines(
      r.moves.map((m) => ({
        speaker: { kind: "narrator" as const },
        key: "tpl" as const,
        tpl: `keepsakes.log.giftMoved.${m.to}`,
        params: { name: onStage.find((c) => c.id === m.owner)?.name.trim() ?? "", gift: r.story.gifts?.[m.id]?.name ?? "" },
      })),
    );
  }, [hydrated, save.story.turn, sandbox, isDemo, getStory, onStage, spots.length, setStoryState, logLines]);

  // Photos that no memory links any more (forgotten, or pushed out by newer memories) are removed from this world.
  const photoLinks = useMemo(() => [...linkedPhotoIds(save.story)].sort().join("|"), [save.story]);
  useEffect(() => {
    const w = activeWorldId();
    if (isDemo || sandbox || !w) return;
    const t = setTimeout(() => void prunePhotos(w, new Set(photoLinks ? photoLinks.split("|") : [])).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [photoLinks, isDemo, sandbox]);

  // Autonomous reaction: when someone walks up to a character outside a conversation (e.g. the test
  // panel's "Walk closer"), the approached character decides how to respond. Story conversations
  // already handle their own reactions, and each pair has a short cooldown so nobody loops.
  const lastArrive = useRef(new Map<string, number>());
  useEffect(() => {
    stage.onArrive = (actorId, targetId) => {
      if (lineInProgressRef.current || talkRef.current?.involves(actorId, targetId)) return;
      const key = `${actorId}>${targetId}`;
      const now = performance.now();
      if (now - (lastArrive.current.get(key) ?? -1e9) < 6000) return;
      lastArrive.current.set(key, now);
      const r = behave({ trigger: "approached", reactorId: targetId, otherId: actorId }, "auto");
      if (r) showLines(r.lines);
    };
    return () => {
      stage.onArrive = null;
    };
  }, [stage, behave, showLines]);


  /** Ask the AI to word a beat. Returns null if it can't, so the built-in lines are used instead. */
  const writeWithAi = useCallback(
    async (beat: Beat, actor: Character, other: Character | null, behaviors: Decision[] = []): Promise<StoryLine[] | null> => {
      if (!world) return null;
      const save = getSave();
      const recentLines = save.log.slice(-8).map((e) => renderLine(e, locale).text).filter(Boolean);
      const delta = beat.bondBefore && beat.bondAfter ? beat.bondAfter.affinity - beat.bondBefore.affinity : null;
      try {
        const out = await requestTurn({
          locale,
          world: world.id,
          place: envType,
          placeDescription: placeDescription.slice(0, 1200),
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
          memories: (getStory().characters[actor.id]?.memories ?? []).slice(-6).map(memoryBrief),
          recentLines: recentLines.map((l) => l.slice(0, 400)),
          behaviors: behaviors.map(behaviorBrief),
        });
        if (beat.memoryId && out.memoryNote && !sandboxRef.current) gameActions.setMemoryNote(actor.id, beat.memoryId, out.memoryNote);
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
    [world, envType, placeDescription, locale, t, getStory],
  );

  // A ref, not just state: two key presses in the same frame must not start two paid AI requests.
  const actingRef = useRef(false);
  const act = useCallback(
    async (action: Action) => {
      if (!selected || !world || busy || actingRef.current || talkRef.current?.active()) return;
      setNote(null);
      // 1. Game rules decide what happens and update state (mood, bonds, memories).
      const { beat, story } = plan({
        story: getStory(),
        cast,
        actorId: selected.id,
        action,
        world: world.id,
        place: envType,
        frequency: settings.eventFrequency,
      });
      setStoryState(story);
      // 1b. The same rules decide how the actor moves: face the other, show the feeling, approach / step back.
      const choreo = choreographBeat(beat, cast, story, (id) => stage.nearest(id), { otherByEngine: true });
      stage.beginConversation(choreo.participants);
      for (const a of choreo.actions) {
        if (a.type === "show_emotion") {
          const e = emotionOf(story.characters[a.actor]);
          stage.syncEmotion(a.actor, e.emotion, e.level, e.at);
        } else stage.request(a, beat.kind === "event" ? "event" : "conversation");
      }
      // 1c. The behavior engine decides how the OTHER person (or the listener) responds:
      //     movement, what shows on their face, and the intention behind their reply.
      const listenerId = beat.kind === "talk" ? (choreo.participants[1] ?? null) : beat.otherId;
      const walkedUp = choreo.actions.some((a) => a.type === "approach" && a.actor === selected.id);
      const response = listenerId ? behave({ trigger: triggerForBeat(beat, walkedUp), reactorId: listenerId, otherId: selected.id }, "story") : null;
      const other = listenerId ? (cast.find((c) => c.id === listenerId) ?? null) : null;
      // 2. A writer puts it into words: the AI if available (told what the engine decided), otherwise built-in templates.
      let lines: StoryLine[] | null = null;
      // Balanced mode (the default) words only Talk and story-event beats with AI; Observe/Wait use built-in lines.
      if (useAi && (ai?.mode === "full" || (beat.kind !== "observe" && beat.kind !== "wait"))) {
        actingRef.current = true;
        setBusy(true);
        try {
          lines = await writeWithAi(beat, selected, other, response ? [response.decision] : []);
        } finally {
          setBusy(false);
          actingRef.current = false;
        }
      }
      lines ??= [...beatToLines(beat, cast, envType, world.id), ...(response?.lines ?? [])];
      setQueue(lines);
      setBeatNo((n) => n + 1);
      setLineIndex(0);
      logLines(lines);
    },
    [selected, world, busy, cast, envType, settings.eventFrequency, useAi, ai?.mode, writeWithAi, stage, getStory, setStoryState, behave, logLines],
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
      if (anyModal || menuOpen || e.isComposing || (e.target instanceof Element && e.target.closest("[data-speech-bubble]")) || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const inTalk = !!talkRef.current?.session;
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
        // Camera: zoom out / in, and follow the selected character again.
        "-": () => updateSettings({ cameraZoom: ZOOMS[Math.max(0, ZOOMS.indexOf(getZoom()) - 1)] }),
        "=": () => updateSettings({ cameraZoom: ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(getZoom()) + 1)] }),
        "+": () => updateSettings({ cameraZoom: ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(getZoom()) + 1)] }),
        f: () => viewportApi.current?.recenter(),
        escape: () => setPauseOpen(true),
        p: () => setPauseOpen(true),
      };
      if (inTalk) {
        // During a walk-and-talk: Esc cancels / ends it; the story actions wait until it's over.
        for (const k2 of ["z", "x", "c", "v"]) delete map[k2];
        map.escape = () => talkRef.current?.cancel();
      }
      if (!onButton) {
        // Enter / Space read through the current conversation first, then start a new one.
        const next = () => (lineInProgress ? advance() : inTalk ? undefined : act("talk"));
        map.enter = next;
        map[" "] = next;
      }
      if (map[k]) {
        e.preventDefault();
        map[k]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModal, menuOpen, act, cycle, advance, lineInProgress, getZoom]);

  // Who is speaking right now (narration has no bubble; it stays in the panel).
  const sp = !busy && current?.speaker.kind === "character" ? current.speaker : null;
  const speakerId = sp ? (sp.id && cast.some((c) => c.id === sp.id) ? sp.id : (cast.find((c) => c.name.trim() === sp.name)?.id ?? null)) : null;
  // SPEAKING lasts while their line is being read; when the conversation is over everyone relaxes.
  const speakingNow = lineInProgress ? speakerId : null;
  useEffect(() => stage.setSpeaker(speakingNow), [stage, speakingNow]);
  useEffect(() => {
    // A walk-and-talk keeps the pair together between lines; it ends the conversation itself.
    if (!lineInProgress && !talking) stage.endConversation();
  }, [stage, lineInProgress, talking]);
  // The camera follows whoever is speaking, otherwise the selected character (WorldViewport).
  const cameraFocusId = speakerId ?? selected?.id ?? null;

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
  const envName = here.name.trim() || (scene.kind === "map" ? scene.name || t("playArea.untitled") : t(`environments.${envType}.name` as const));
  // Leaving an area: the confirmation's wording and who could come along.
  const tvActor = travel ? castRef.current.find((c) => c.id === travel.actorId) : null;
  const tvDest = travel?.to ? sceneById(scenes, travel.to) : null;
  const leaveBody = travel
    ? travel.fromDialogue && tvDest
      ? t("explore.leave.npc", { name: tvActor?.name.trim() ?? "", scene: sceneLabel(tvDest), exit: objectName(travel.exitId) })
      : tvDest
        ? t("explore.leave.bodyTo", { name: tvActor?.name.trim() ?? "", exit: objectName(travel.exitId), scene: sceneLabel(tvDest) })
        : t("explore.leave.bodyNew", { name: tvActor?.name.trim() ?? "", exit: objectName(travel.exitId) })
    : "";
  const menuObj = objMenu ? stage.objectById(objMenu.objectId) : null;
  const menuActor = objMenu ? cast.find((c) => c.id === objMenu.actorId) : null;
  const selectedName = selected ? selected.name.trim() || t("common.unnamed") : null;
  // Photos and gifts belong to a saved character in the active world save (not the demo cast or a debug scenario).
  const interactWith = interaction ? (cast.find((c) => c.id === interaction.characterId) ?? null) : null;
  const interactName = interactWith ? interactWith.name.trim() || t("common.unnamed") : "";
  const canKeep = !isDemo && !sandbox && !!interactWith && save.characters.some((c) => c.id === interactWith.id);
  const keepWorldId = canKeep ? activeWorldId() : null;
  /** Saved photos are shown (from this world only) outside the demo cast and debug scenarios. */
  const keepPhotosWorld = !isDemo && !sandbox ? activeWorldId() : null;


  // Emotion & movement test panel: beside the stage on desktop, under the dialogue on phones
  // (where the stage then stays pinned at the top so you can watch while you tap).
  const testPanel = settings.testPanel ? (
    <StageTestPanel
      stage={stage}
      cast={onStage}
      selectedId={selected?.id ?? null}
      frozen={frozen}
      onFreeze={setFrozen}
      onTalk={() => act("talk")}
      compact={wide}
      onClose={() => {
        setFrozen(false);
        updateSettings({ testPanel: false });
      }}
    />
  ) : null;

  // Behavior Debug Panel (developers only): same column as the test panel.
  const debugPanel =
    devMode && settings.behaviorDebug ? (
      <BehaviorDebugPanel
        cast={onStage}
        story={story}
        selectedId={selected?.id ?? null}
        decisions={decisions}
        sandboxKey={sandbox?.key ?? null}
        compact={wide}
        onRun={(event, rng) => {
          const r = behave(event, "story", { rng });
          if (r) showLines(r.lines);
          return r?.decision ?? null;
        }}
        onPreview={(event, rng) => behave(event, "story", { rng, apply: false })?.decision ?? null}
        onLoadScenario={(key) => {
          const sc = scenarioByKey(key);
          if (!sc) return;
          const built = buildScenario(sc, locale);
          stage.cancelAll();
          setDecisions([]);
          setQueue([]);
          setSandbox({ key, cast: built.cast, story: built.story });
          setPickedId(built.reactorId);
          return { reactorId: built.reactorId, otherId: built.otherId, trigger: sc.trigger };
        }}
        onExitScenario={() => {
          stage.cancelAll();
          setDecisions([]);
          setQueue([]);
          setSandbox(null);
          setPickedId(null);
        }}
        onPassTime={() => {
          const s = getStory();
          setStoryState({ ...s, turn: s.turn + 1, characters: Object.fromEntries(Object.entries(s.characters).map(([id, st]) => [id, fadeEmotion(st)])) });
        }}
        onClose={() => updateSettings({ behaviorDebug: false })}
      />
    ) : null;
  // Relationship Inspector (developers only): why each relationship is where it is.
  const relPanel =
    devMode && settings.relationshipInspector ? (
      <RelationshipInspector
        cast={onStage}
        story={story}
        selectedId={selected?.id ?? null}
        compact={wide}
        onClose={() => updateSettings({ relationshipInspector: false })}
      />
    ) : null;
  const sidePanels = testPanel || debugPanel || relPanel ? (
    <>
      {debugPanel}
      {relPanel}
      {testPanel}
      {settings.testPanel && !isDemo && !sandbox ? <AutonomyDebug story={story} cast={onStage} objectName={objectName} /> : null}
    </>
  ) : null;

  // Phones: keep the stage pinned at the top while a developer panel is open below the dock.
  const pinStage = !wide && !!sidePanels;
  const playH = layout.height;
  // Stacked: the dock keeps a fixed share under the viewport. Side by side: the viewport may use the full
  // height (minus the keyboard hint) and the dock matches it.
  const dockH = stackDockHeight(playH);
  const hintH = wide && !layout.short ? 18 : 0;
  // Stacked during a conversation: the character row (disabled then anyway) gives its room to the choices;
  // character info stays one tap away from the conversation header.
  /** Small windows: tighter dock, and "Talk to…" moves into the dock header. */
  const compactDock = layout.short || (!wide && playH < 600);
  const hidePad = !!talk.session && (!wide || layout.short);
  // The viewport's own pixel frame sits outside the height it is given.
  const viewportMax = playH ? (wide ? playH - hintH : playH - dockH - 8) - layout.frame : undefined;

  /** Character info: the details panel under the play area (side by side) or the drawer (phones). */
  const openInfo = (tab?: SideTab) => {
    if (tab) setInfoTab({ tab, n: Date.now() });
    if (!wide) {
      setSheetOpen(true);
      return;
    }
    setDetailsOpen(true);
    // Bring the top of the panel up to just under the middle of the window: the scene stays partly in view.
    requestAnimationFrame(() => {
      const el = detailsRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.85) window.scrollBy({ top: top - window.innerHeight * 0.55, behavior: reducedMotion ? "auto" : "smooth" });
    });
  };

  return (
    <main data-layout="wide" className={`content-grid flex-1 ${layout.short ? "pt-1.5" : "pt-2 sm:pt-3"}`} style={{ paddingBottom: `max(${PAGE_BOTTOM_GAP}px, env(safe-area-inset-bottom, 0px))` }}>
      {/* HUD */}
      <div className={`content-block flex items-center justify-between gap-3 ${layout.short ? "mb-1.5" : "mb-2"}`}>
        <div className="min-w-0">
          {!layout.short && (
            <p className="truncate font-label text-[10px] uppercase" style={{ color: world.accent }}>
              {worldName}
            </p>
          )}
          <h1 className={`truncate font-head font-bold ${layout.short ? "text-lg" : "text-xl sm:text-2xl"}`}>{envName}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden font-label text-[10px] uppercase text-ink-mute md:inline" title={t("settings.aiStoryDesc")}>
            {useAi ? t("play.writer.ai") : t("play.writer.builtin")}
          </span>
          {scene.kind === "map" && scene.layout.reviewed && (
            <PixelButton size="sm" variant="ghost" icon="pencil" onClick={() => setAreaOpen(true)} aria-label={t("playArea.edit")} data-edit-play-area>
              <span className="hidden xl:inline">{t("playArea.title")}</span>
            </PixelButton>
          )}
          <PixelButton size="sm" variant="magic" icon="book" onClick={() => setLogOpen(true)} aria-label={t("play.storyLog")}>
            <span className="hidden min-[420px]:inline">{t("play.storyLog")}</span>
            <span className="bg-lavender-hi px-1 text-[11px] text-label tabular-nums">{save.log.length}</span>
          </PixelButton>
          <PixelButton size="sm" variant="primary" icon="pause" onClick={() => setPauseOpen(true)} aria-label={t("play.pauseMenu")} className="min-w-11">
            <span className="hidden sm:inline">{t("play.pause")}</span>
          </PixelButton>
        </div>
      </div>

      {scene.kind === "builtin" && scene.missingMapId && (
        <SceneNotice tone="warn" action={<PixelLink href="/builder" size="sm" variant="ghost" icon="map">{t("playArea.openBuilder")}</PixelLink>}>
          {t("playArea.missingNotice")}
        </SceneNotice>
      )}
      {here.placeholder && scene.kind === "builtin" && !scene.missingMapId && (
        <SceneNotice action={<PixelLink href="/builder" size="sm" variant="ghost" icon="map">{t("playArea.openBuilder")}</PixelLink>}>
          {t("explore.scene.placeholder", { name: envName })}
        </SceneNotice>
      )}
      {scene.kind === "map" && !scene.layout.reviewed && (
        <SceneNotice action={<PixelButton size="sm" variant="calm" icon="pencil" onClick={() => setAreaOpen(true)} data-edit-play-area>{t("playArea.edit")}</PixelButton>}>
          {sceneId !== firstSceneId ? t("explore.scene.incomplete", { name: envName }) : t("playArea.guessNotice", { name: envName })}
        </SceneNotice>
      )}
      {scene.kind === "map" && <SceneEditor open={areaOpen} map={scene.map} onClose={() => setAreaOpen(false)} cast={save.characters.map((c) => ({ id: c.id, name: c.name.trim() || t("common.unnamed") }))} />}

      {isDemo && !sandbox && (
        <p className="content-block plain-pad-x mb-4 flex flex-wrap items-center gap-2 bg-butter-hi py-2 text-base text-ink-soft shadow-[inset_4px_0_0_var(--color-butter-lo)]">
          <PixelIcon name="star" size={12} className="shrink-0 text-label" />
          <span className="min-w-0 flex-1">{t("play.demoNotice")}</span>
          <PixelButton size="sm" variant="calm" icon="user" onClick={() => gameActions.addSampleCast(locale)} className="shrink-0 px-2" data-sample-cast>
            {t("play.sampleCast")}
          </PixelButton>
        </p>
      )}

      {/* Play area: the world and the dialogue dock as one screen (lib/playLayout.ts). Side by side on wide
          windows, stacked on tall ones, and sized to end at the window's bottom edge so the scene and the
          response choices are visible together. What doesn't fit scrolls inside the dock, not the page. */}
      {(() => {
        const viewport = (
          <div className="relative">
            <SceneTitleCard k={titleKey} title={envName} subtitle={worldName} />
            <WorldViewport
              apiRef={viewportApi}
              art={scene.kind === "loading" ? environmentArt[world.id][envType] : scene.art}
              imageWidth={scene.kind === "map" ? scene.map.width : undefined}
              label={t("play.viewportAlt", { place: envName, world: worldName })}
              frame={world.frame}
              tag={here.placeholder ? t("explore.picker.placeholderTag") : t("common.placeholder")}
              stage={stage}
              focusId={cameraFocusId}
              zoom={zoom}
              onZoom={(z) => updateSettings({ cameraZoom: z })}
              followSpeed={settings.cameraFollow ?? "normal"}
              reducedMotion={reducedMotion}
              maxHeight={viewportMax}
              followLabel={talking ? t("camera.followTalk") : undefined}
              drag={drag.store}
              onDragScroll={drag.refresh}
              onTap={onMapTap}
              locked={anyModal}
              sceneKey={roomKey}
              overlay={
                <StageOverlay
                  stage={stage}
                  characters={cast}
                  selectedId={selected?.id ?? null}
                  speakerId={speakerId}
                  bubble={{ lineId, speaker: shownLine.speaker, typer, more, onAdvance: advance }}
                  drag={drag.store}
                  showNav={!!settings.testPanel}
                  chooser={talk.session?.phase === "SELECT_TARGET" ? { actorId: talk.session.actorId, choices: onStage.filter((c) => c.id !== talk.session!.actorId).map((c) => c.id) } : null}
                  objectHint={objectHint}
                  extra={<WorldMarks objects={ownObjects} stateOf={objectState} labelOf={(o) => o.label ?? null} reducedMotion={reducedMotion} />}
                />
              }
            >
              {scene.kind === "map" && <SceneFronts src={scene.art.src} size={scene.built.size} fronts={scene.built.fronts} pixelated={!scene.art.smooth} stage={stage} actorIds={cast.map((c) => c.id)} />}
              {scene.kind === "loading" && <SceneLoading />}
              <StageGifts placed={placeDisplayed(story, spots, sceneOfGifts)} nameOf={(id) => cast.find((c) => c.id === id)?.name.trim() ?? ""} />
              <StageActors stage={stage} characters={cast} selectedId={selected?.id ?? null} onSelect={onStageSelect} onPressStart={drag.onPressStart} reducedMotion={reducedMotion} />
            </WorldViewport>
          </div>
        );
        const moments = (photoMoment.moment?.played || giftMoment.moment?.played) ? (
          <>
            {photoMoment.moment?.played && (
              <PhotoMomentCard
                moment={photoMoment.moment}
                onSave={async () => {
                  const m = photoMoment.moment;
                  if (m && (await photoMoment.save())) logLines([{ speaker: { kind: "narrator" }, key: "tpl", tpl: "keepsakes.log.photoSaved", params: { name: m.name } }]);
                }}
                onDismiss={photoMoment.dismiss}
                onOpenMemories={() => {
                  setPickedId(photoMoment.moment!.characterId);
                  openInfo("memories");
                }}
              />
            )}
            {giftMoment.moment?.played && (
              <GiftMomentCard
                moment={giftMoment.moment}
                onDismiss={giftMoment.dismiss}
                onOpenThings={() => {
                  setPickedId(giftMoment.moment!.characterId);
                  openInfo("things");
                }}
              />
            )}
          </>
        ) : null;
        const dock = (
          <DialogueBox
            speaker={busy ? t("scene.narrator") : shownLine.speaker}
            text={busy ? "" : shownLine.text}
            typer={typer}
            onAdvance={advance}
            lineId={lineId}
            history={busy ? [] : history}
            targetName={selectedName}
            onAction={act}
            index={lineIndex}
            total={Math.max(1, queue.length)}
            busy={busy}
            note={note}
            hideActions={talking}
            actionsDisabled={!!talk.session}
            compact={compactDock}
            headerAction={
              compactDock && !talk.session ? (
                <PixelButton size="sm" variant="calm" icon="chat" disabled={!selected || onStage.length < 2} onClick={() => selected && talk.beginSelect(selected.id)} className="!min-h-9 shrink-0 px-2 text-[13px]" data-talk-to>
                  {t("talk.chooseButton")}
                </PixelButton>
              ) : undefined
            }
            extra={moments}
            talk={
              <>
                <TalkStrip talk={talk} cast={onStage} selectedId={selected?.id ?? null} touch={touch} idle={!compactDock} />
                <ConversationPanel talk={talk} cast={onStage} story={story} lineInProgress={lineInProgress || busy} aiMode={aiTalk} onInfo={hidePad ? () => openInfo() : undefined} />
              </>
            }
            footer={
              hidePad ? null : <ControlPad
                name={selectedName}
                mood={selected ? tx(`moods.${(story.characters[selected.id] ?? neutralState()).mood}`) : null}
                onPrev={() => cycle(-1)}
                onNext={() => cycle(1)}
                onInfo={() => (wide && detailsOpen ? setDetailsOpen(false) : openInfo())}
                infoOpen={wide && detailsOpen}
                disabled={cast.length === 0 || busy || !!talk.session}
              />
            }
          />
        );
        return (
          <div
            ref={playRef}
            data-play-area={layout.shape}
            className="content-block"
            style={wide || !playH ? undefined : pinStage ? { minHeight: playH } : { height: playH }}
          >
            {wide ? (
              <>
                {/* Primary alignment: the viewport and the dock share one row, so their top and bottom edges line
                    up; the keyboard hint sits under both, never inside one column. */}
                <div className="grid items-start" style={{ gap: "var(--grid-gap)", gridTemplateColumns: `minmax(0, 1fr) var(${layout.short ? "--sidebar-w-short" : "--sidebar-w"})` }}>
                  <div className="min-w-0">{viewport}</div>
                  <div className="relative min-w-0 self-stretch" style={{ minHeight: playH ? sideDockMin(playH) : 360 }}>
                    <div className="absolute inset-0">{dock}</div>
                  </div>
                </div>
                {hintH > 0 && <p className="mt-1 truncate font-label text-[10px] uppercase leading-[14px] text-ink-mute">{t("play.keyboardHint")}</p>}
              </>
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div className={pinStage ? "sticky z-30" : undefined} style={pinStage ? { top: headerH } : undefined}>
                  {viewport}
                </div>
                <div className="min-h-0 flex-1" style={pinStage ? { flex: "0 0 auto", height: dockH } : { minHeight: Math.min(dockH, 300) }}>
                  {dock}
                </div>
                {sidePanels && <div className="content-stack mt-2">{sidePanels}</div>}
              </div>
            )}
          </div>
        );
      })()}

      {/* Desktop: character details and developer panels live under the play area, opened on demand. */}
      {wide && (detailsOpen || sidePanels) && (
        <section ref={detailsRef} aria-label={t("play.details")} className="content-block mt-6 grid items-start gap-x-4 gap-y-8 scroll-mt-24 lg:grid-cols-2 2xl:grid-cols-3" data-character-details>
          {detailsOpen && (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 font-head text-lg font-bold leading-tight">
                  {t("play.details")}
                  <span className="block text-sm font-normal text-ink-soft">{t("play.detailsHint", { name: selectedName ?? t("common.unnamed") })}</span>
                </h2>
                <PixelButton size="sm" variant="ghost" icon="close" onClick={() => setDetailsOpen(false)} className="shrink-0 px-2" data-details-close>
                  {t("play.sidebar.hide")}
                </PixelButton>
              </div>
              <div className="pt-4">
                <CharacterInfoPanel character={selected} cast={cast} story={story} isDemo={isDemo && !sandbox} onEditMemory={editMemoryFor} photoWorldId={keepPhotosWorld} onDeletePhoto={deletePhotoFor} showTab={infoTab} />
              </div>
            </div>
          )}
          {sidePanels}
        </section>
      )}

      {/* Personal interactions: Photo / Gift menu next to the character, and the windows it opens */}
      {interactWith && interaction?.kind === "menu" && (
        <InteractionMenu
          characterId={interactWith.id}
          name={interactName}
          unavailable={canKeep ? null : t("keepsakes.menu.demo")}
          onClose={() => setInteraction(null)}
          onPick={(kind) => setInteraction({ kind, characterId: interactWith.id })}
        />
      )}
      {interactWith && (
        <>
          <PhotoPanel
            open={interaction?.kind === "photo"}
            canKeep={canKeep}
            ai={aiTalk}
            characterId={interactWith.id}
            name={interactName}
            onClose={() => setInteraction(null)}
            onSend={async (shot, caption, signal) => {
              const id = interactWith.id;
              const r = await photoMoment.send(id, shot, caption, signal);
              if (r.ok) {
                logLines([{ speaker: { kind: "narrator" }, key: "tpl", tpl: caption.trim() ? "keepsakes.log.photoCaption" : "keepsakes.log.photo", params: { name: interactWith.name.trim(), caption: caption.trim() } }]);
                setPickedId(id);
                setInteraction(null);
              }
              return r;
            }}
          />
          <GiftCreator
            open={interaction?.kind === "gift"}
            worldId={keepWorldId}
            world={world.id}
            characterId={interactWith.id}
            name={interactName}
            ai={aiTalk}
            onClose={() => setInteraction(null)}
            onGive={async (g, signal) => {
              const id = interactWith.id;
              const r = await giftMoment.give(id, g, signal);
              if (r.ok) {
                logLines([{ speaker: { kind: "narrator" }, key: "tpl", tpl: "refused" in r && r.refused ? "keepsakes.log.giftRefused" : "keepsakes.log.gift", params: { name: interactWith.name.trim(), gift: g.name } }]);
                setPickedId(id);
                setInteraction(null);
              }
              return r;
            }}
          />
        </>
      )}

      {/* Explorable world: the object action menu, leaving an area, the fade and the destination picker */}
      {objMenu && menuObj && menuActor && !travel && (
        <ObjectActionMenu
          title={t("explore.menu.title", { name: menuActor.name.trim() || t("common.unnamed"), object: objectName(menuObj.id) })}
          actions={actionsFor(menuActor.id, menuObj)}
          anchor={() => {
            const api = viewportApi.current;
            const o = stage.objectById(objMenu.objectId);
            if (!api || !o) return null;
            const a = api.toScreen({ x: o.bounds.x0, y: o.bounds.y0 });
            const b = api.toScreen({ x: o.bounds.x1, y: o.bounds.y1 });
            return a && b ? { left: a.x, top: a.y, right: b.x, bottom: b.y } : null;
          }}
          onPick={(action) => {
            const m = objMenu;
            setObjMenu(null);
            sendToRef.current(m.actorId, { objectId: m.objectId, action });
          }}
          onClose={() => setObjMenu(null)}
        />
      )}
      <LeaveAreaDialog
        open={travel?.phase === "confirm"}
        body={leaveBody}
        party={onStage.map((c) => ({ id: c.id, name: c.name.trim() || t("common.unnamed"), fixed: c.id === travel?.actorId }))
          .sort((a, b) => Number(b.fixed) - Number(a.fixed))}
        chosen={travel?.party ?? []}
        onToggle={(id) => setTravel((tv) => (tv ? { ...tv, party: tv.party.includes(id) ? tv.party.filter((x) => x !== id) : [...tv.party, id] } : tv))}
        onStay={stayHere}
        onLeave={leaveNow}
      />
      <FadeCurtain shown={!!travel && travel.phase !== "confirm"} reducedMotion={reducedMotion}>
        {travel?.phase === "arriving" && <CurtainStatus busy text={t("explore.travel.loading", { scene: tvDest ? sceneLabel(tvDest) : "" })} />}
      </FadeCurtain>
      <ScenePicker
        open={travel?.phase === "pick" || travel?.phase === "generating"}
        worldName={worldName}
        scenes={scenes.list}
        currentId={sceneId}
        connectedIds={neighbours(scenes, sceneId)}
        sceneName={sceneLabel}
        thumbOf={(sc) => (sc.mapId ? (mapStudio.maps.find((m) => m.id === sc.mapId)?.url ?? environmentArt[world.id][sc.envType].src) : environmentArt[world.id][sc.envType].src)}
        presentCount={(sc) => presentIn(scenes, sc.id, save.characters).length}
        canGenerate={!!ai?.image}
        generating={travel?.phase === "generating"}
        error={travel?.error ?? null}
        defaultType={envType as EnvironmentTypeId}
        twoWayDefault={twoWayByDefault(linkKindFor(travel ? (stage.objectById(travel.exitId)?.type ?? "exit") : "exit"))}
        full={scenes.list.length >= 24}
        onCreate={(d, how, twoWay) => void createScene(d, how, twoWay)}
        onChoose={chooseScene}
        onCancel={() => setTravel(null)}
      />

      {/* Phone / tablet character sheet */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("play.character")} closeLabel={t("play.sidebar.close")}>
        <CharacterInfoPanel character={selected} cast={cast} story={story} isDemo={isDemo && !sandbox} framed={false} onEditMemory={editMemoryFor} photoWorldId={keepPhotosWorld} onDeletePhoto={deletePhotoFor} showTab={infoTab} />
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
                    {"source" in e && e.source === "mock" && <span className="ml-1 bg-butter-hi px-1 text-ink" title={t("talk.ai.testTag")}>TEST</span>}
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
