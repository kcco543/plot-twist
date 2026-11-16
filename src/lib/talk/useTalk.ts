"use client";

/**
 * The play screen's walk-and-talk controller. Connects the conversation flow
 * (flow.ts) to the systems that already exist:
 *
 *  - movement: the stage simulation's validated "approach" action (same
 *    pathfinding + collision as everything else), at player priority;
 *  - facing / staying together: face_target + beginConversation();
 *  - lines: the play screen's single dialogue queue, so speech bubbles, the
 *    dialogue panel and the story log all show the conversation;
 *  - the listener's answer: the behavior engine (decide + apply), with the
 *    topic's trigger;
 *  - state: story state (relations, memories, events) via the same setter
 *    every other system uses.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, EnvironmentTypeId, StoryLine, StoryState, WorldId } from "../types";
import type { StageSim } from "../stage/sim";
import type { BehaviorEvent, Decision } from "../mind";
import { decisionLines } from "../mind";
import { emotionOf, withEmotion } from "../emotion/emotions";
import { bondBetween, rngFrom, talkDistance } from "../stage/behavior";
import { CHOOSING_PHASES, goTo, newSession, TALKING_PHASES, type TalkNotice, type TalkNoticeKind, type TalkSession } from "./flow";
import { applyCustom, applyTopic, sayKey, suggestTopics, talkContext, toneOf, type TopicChoice } from "./topics";
import { personalityOf } from "../mind/profile";
import { cleanMessage } from "./customReply";
import type { IdleKind } from "../stage/actions";
import { applyReply, pushTalkLine, validateReply, type ValidatedReply } from "./ai/apply";
import type { TalkRequest, TalkSuggestion } from "./ai/contract";
import { buildTalkRequest, sendTalkRequest, type TalkResult } from "./ai/request";
import { applyDecisionOutcome, decideRequest, type RequestDecision } from "../relationships/boundaries";
import { TOPIC_LISTENER_KIND } from "./topics";

/** Intentions the built-in lines can voice honestly (refusals and the like). Agreement and disclosure need the AI. */
const BUILTIN_INTENTIONS = ["refuse_polite", "refuse_firm", "explain_boundary", "deflect", "change_subject", "question_intent", "express_discomfort", "end_conversation", "hesitate", "disagree"];
export const builtinFor = (d: RequestDecision | null) => (d && BUILTIN_INTENTIONS.includes(d.intention) ? d.intention : null);

/** A walk that takes longer than this is given up (target kept running off, etc.). */
export const WALK_TIMEOUT_MS = 20000;
/** Pause between arriving / facing and the options appearing. */
const FACE_MS = 450;

export type TalkDeps = {
  stage: StageSim;
  cast: Character[];
  world: WorldId;
  place: EnvironmentTypeId;
  locale: string;
  getStory: () => StoryState;
  setStoryState: (s: StoryState) => void;
  /** Behavior engine, split: decide without applying, then apply (movement, feelings, relations). */
  decideOnly: (event: BehaviorEvent) => Decision | null;
  commit: (d: Decision) => void;
  showLines: (lines: StoryLine[]) => void;
  /** Dialogue queue position, so the flow knows when a line has been read. */
  beatNo: number;
  lineIndex: number;
  lineInProgress: boolean;
  /** Recent story-log lines, "Speaker: text" (context for AI replies). */
  recentText: () => string[];
  /** AI conversations: "ai" (Claude), "mock" (developer TEST replies) or null (off: built-in replies). */
  ai: "ai" | "mock" | null;
  placeDescription: string;
  /** Render a stored line into text in the current language (what the AI is told was said). */
  renderText: (line: StoryLine) => string;
  onSelect: (id: string) => void;
  /** The conversation ended (or was cancelled) while its lines may still be playing. */
  onEnd?: () => void;
  /** Character autonomy (src/lib/autonomy/useAutonomy.ts): boundaries after an ending, plans said out loud. */
  autonomy?: {
    refusesTalk: (listenerId: string, speakerId: string) => unknown;
    refused: (listenerId: string, speakerId: string) => void;
    talking: (a: string, b: string) => void;
    endedConversation: (listenerId: string, speakerId: string) => void;
    heard: (speakerId: string, text: string) => void;
    conversationOver: (ids: string[]) => void;
  };
};

export type TalkController = ReturnType<typeof useTalk>;

/** One AI reply being written (or failed, waiting for "Try again"). */
type AiJob = {
  req: TalkRequest;
  abort: AbortController;
  promise: Promise<TalkResult>;
  sessionId: number;
  meId: string;
  themId: string;
  /** Built-in reaction to show (clearly labelled) if the AI fails on a suggested topic. */
  decision: Decision | null;
  /** The game's decision about the request (boundaries), binding on the reply. */
  request: RequestDecision | null;
  /** What the speaker said (evidence for the relationship change). */
  text: string;
  fallback: StoryLine[] | null;
  state: "pending" | "shown" | "failed";
  awaited: boolean;
};
type Convo = {
  /** Dialogue-queue beat holding our current lines. */
  beat: number;
  decision: Decision | null;
  /** Typed message waiting for a reply that can't come (AI off). */
  custom: string | null;
  job: AiJob | null;
  /** What the speaker has said in this conversation (so suggestions don't repeat it). */
  said: string[];
  /** The listener ends the conversation once this line has been read. */
  closing: boolean;
};
const emptyConvo = (): Convo => ({ beat: -1, decision: null, custom: null, job: null, said: [], closing: false });
const aiBusy = (c: Convo) => c.job?.state === "pending";
/** Failures worth a "Try again" button. */
const RETRYABLE = new Set(["timeout", "offline", "failed", "rate_limited", "busy", "invalid_output", "refused"]);

const IDLE_FOR: Record<string, IdleKind> = {
  angry: "stomp",
  frustrated: "sigh",
  sad: "sigh",
  anxious: "shiver",
  excited: "hop",
  happy: "hop",
  affectionate: "shift",
  embarrassed: "shift",
  surprised: "look_around",
  confused: "look_around",
  neutral: "shift",
};

export function useTalk(d: TalkDeps) {
  const [session, setSessionState] = useState<TalkSession | null>(null);
  const [notice, setNotice] = useState<TalkNotice | null>(null);
  const ref = useRef<TalkSession | null>(null);
  const deps = useRef(d);
  deps.current = d;
  const nextId = useRef(1);
  const walk = useRef<{ started: number; dist: number }>({ started: 0, dist: 30 });
  const convo = useRef<Convo>(emptyConvo());
  /** A built-in boundary line is waiting for the speaker's line to finish (AI off). */
  const pendingBuiltin = useRef(false);

  const set = useCallback((s: TalkSession | null) => {
    ref.current = s;
    setSessionState(s);
  }, []);
  const nameOf = (id: string | null) => {
    const c = id ? deps.current.cast.find((x) => x.id === id) : null;
    return c ? c.name.trim() : "";
  };
  const tell = useCallback((kind: TalkNoticeKind, actor: string | null, target: string | null) => {
    setNotice({ kind, actor: nameOf(actor), target: nameOf(target), at: Date.now() });
  }, []);

  /** Leave the conversation (or the walk / the target choice). */
  const end = useCallback(
    (kind: TalkNoticeKind | null = null) => {
      const s = ref.current;
      if (!s) return;
      const { stage } = deps.current;
      if (s.phase === "MOVE_TO_TARGET") stage.cancelWalk(s.actorId);
      if (TALKING_PHASES.includes(s.phase)) {
        stage.endConversation();
        deps.current.onEnd?.();
        // Plans someone said during the conversation ("I'm going to the window") are carried out now.
        deps.current.autonomy?.conversationOver([s.actorId, ...(s.targetId ? [s.targetId] : [])]);
      }
      convo.current.job?.abort.abort();
      convo.current = emptyConvo();
      set(null);
      if (kind) tell(kind, s.actorId, s.targetId);
    },
    [set, tell],
  );

  /** Tap-to-target: choose who `actorId` should talk to (tap them on stage or in the list). */
  const beginSelect = useCallback(
    (actorId: string) => {
      if (ref.current) end();
      setNotice(null);
      set(newSession(nextId.current++, actorId, "tap"));
    },
    [end, set],
  );

  /** Walk `actorId` over to `targetId` and open a conversation when they get there. */
  const startWalk = useCallback(
    (actorId: string, targetId: string, via: TalkSession["via"]): boolean => {
      const { stage, getStory, cast } = deps.current;
      if (actorId === targetId) return false;
      const me = cast.find((c) => c.id === actorId);
      const them = cast.find((c) => c.id === targetId);
      if (!me || !them || !stage.position(actorId) || !stage.position(targetId)) return false;
      // One conversation at a time: starting a new one ends the old one.
      if (ref.current) end();
      setNotice(null);
      const story = getStory();
      const dist = Math.max(22, talkDistance(me, bondBetween(story, actorId, targetId), emotionOf(story.characters[actorId]).emotion));
      if (stage.stateOf(actorId) === "speaking") {
        tell("busy", actorId, targetId);
        return false;
      }
      // Check the route BEFORE moving anyone: no route = feedback, never a forced walk.
      if (stage.previewApproach(actorId, targetId, dist) === null) {
        tell(stage.previewApproach(actorId, targetId, dist, { ignorePeople: true }) ? "blocked" : "unreachable", actorId, targetId);
        return false;
      }
      const res = stage.request({ type: "approach", actor: actorId, target: targetId, distance: dist }, "conversation", "player");
      if (!res.ok) {
        tell(res.reason === "no_room" ? "noRoom" : res.reason === "busy" || res.reason === "outranked" ? "busy" : "unreachable", actorId, targetId);
        return false;
      }
      walk.current = { started: performance.now(), dist };
      deps.current.onSelect(actorId);
      const s0 = newSession(nextId.current++, actorId, via);
      set(goTo(s0, "MOVE_TO_TARGET", { targetId }));
      return true;
    },
    [end, set, tell],
  );

  /**
   * Open a conversation with someone across something (the bartender behind
   * the bar counter) without walking up to them: the caller already walked
   * the actor to a valid spot at the counter.
   */
  const talkHere = useCallback(
    (actorId: string, targetId: string, via: TalkSession["via"]): boolean => {
      const { stage, cast } = deps.current;
      if (actorId === targetId || !cast.some((c) => c.id === actorId) || !cast.some((c) => c.id === targetId)) return false;
      if (!stage.position(actorId) || !stage.position(targetId)) return false;
      if (ref.current) end();
      setNotice(null);
      walk.current = { started: performance.now(), dist: 999 };
      deps.current.onSelect(actorId);
      const s0 = newSession(nextId.current++, actorId, via);
      set(goTo(goTo(s0, "MOVE_TO_TARGET", { targetId }), "FACE_TARGET"));
      return true;
    },
    [end, set],
  );

  // ---- MOVE_TO_TARGET: watch the walk (re-aims happen inside the sim when the target moves).
  const phase = session?.phase ?? null;
  useEffect(() => {
    if (phase !== "MOVE_TO_TARGET") return;
    const { stage } = deps.current;
    const check = () => {
      const s = ref.current;
      if (!s || s.phase !== "MOVE_TO_TARGET" || !s.targetId) return;
      if (!stage.position(s.targetId)) return end("targetLeft");
      if (!stage.position(s.actorId)) return end("cancelled");
      const w = stage.walkOf(s.actorId);
      if (w) {
        if (w.targetId !== s.targetId) return end("cancelled");
        if (performance.now() - walk.current.started > WALK_TIMEOUT_MS) return end("tooLong");
        return;
      }
      const gap = stage.gapBetween(s.actorId, s.targetId) ?? Infinity;
      if (gap <= walk.current.dist + 10) set(goTo(s, "FACE_TARGET"));
      else end("lostTarget");
    };
    check();
    const unsubscribe = stage.subscribe(check);
    return () => {
      unsubscribe();
    };
  }, [phase, end, set]);

  const freshTopics = useCallback((s: TalkSession): TopicChoice[] => {
    const { cast, getStory, world, place } = deps.current;
    const me = cast.find((c) => c.id === s.actorId);
    const them = cast.find((c) => c.id === s.targetId);
    if (!me || !them) return [];
    const story = getStory();
    const rng = rngFrom(`${story.turn}:${me.id}:${them.id}:${s.round}:${Date.now()}`);
    return suggestTopics(talkContext(story, me, them, world, place), rng, s.offered);
  }, []);

  /** Hybrid suggestions: up to two AI-written lines from the last reply, filled up with rule-based topics. */
  const nextOptions = useCallback(
    (s: TalkSession): Partial<TalkSession> => {
      const ai = s.aiTopics.slice(0, 2);
      const rules = freshTopics(s).slice(0, Math.max(1, 3 - ai.length));
      return { aiTopics: ai, topics: rules, offered: [...s.offered, ...rules.map((t) => t.id)] };
    },
    [freshTopics],
  );

  /** The listener's validated movement: face the speaker, then at most one allowed action (walls/people checked by the stage). */
  const playMovement = useCallback((v: ValidatedReply, me: Character, them: Character) => {
    const { stage, getStory } = deps.current;
    stage.request({ type: "face_target", actor: them.id, target: me.id }, "conversation", "story");
    if (stage.walkOf(them.id)) return; // already moving: never stack a second, possibly contradictory, walk
    if (v.movement === "approach") {
      const dist = Math.max(18, Math.round(talkDistance(them, bondBetween(getStory(), them.id, me.id), v.emotion) * 0.7));
      if ((stage.gapBetween(them.id, me.id) ?? 0) > dist + 4) stage.request({ type: "approach", actor: them.id, target: me.id, distance: dist }, "conversation", "story");
    } else if (v.movement === "retreat") {
      stage.request({ type: "retreat", actor: them.id, from: me.id, distance: 16 }, "conversation", "story");
    } else if (v.movement === "idle_reaction") {
      stage.schedule(350, { type: "idle_reaction", actor: them.id, kind: IDLE_FOR[v.emotion] ?? "shift" }, "conversation", "story");
    }
  }, []);

  /** The listener carries out the game's decision with a built-in line (refusal, explanation, ending…). */
  const showBoundaryLine = useCallback((job: Pick<AiJob, "request" | "meId" | "themId">, me: Character, them: Character, intention: string) => {
    const { getStory, setStoryState, showLines, beatNo, stage } = deps.current;
    const req = job.request!;
    let next = applyDecisionOutcome(getStory(), req, them, me, "talk-builtin").story;
    // A refusal is felt: discomfort rises with each repeat.
    const st = next.characters[them.id];
    const emo = req.refusedBefore >= 2 ? "frustrated" : req.refusedBefore === 1 ? "anxious" : intention === "disagree" ? "neutral" : "embarrassed";
    if (st) next = { ...next, characters: { ...next.characters, [them.id]: withEmotion(st, emo, req.refusedBefore >= 2 ? 2 : 1, Date.now()) } };
    next = pushTalkLine(next, them.id, me.id, { from: them.id, text: `(${intention})`, turn: next.turn, at: Date.now(), source: "builtin" });
    setStoryState(next);
    const e = emotionOf(next.characters[them.id]);
    stage.syncEmotion(them.id, e.emotion, e.level, e.at);
    stage.request({ type: "face_target", actor: them.id, target: me.id }, "conversation", "story");
    if (req.endConversation) convo.current.closing = true;
    if (convo.current.job) convo.current.job.state = "shown";
    convo.current.beat = beatNo + 1;
    showLines([{ speaker: { kind: "character", name: them.name.trim(), id: them.id }, key: "tpl", tpl: `rel.say.${intention}`, index: next.turn, params: { other: me.name.trim(), name: them.name.trim() }, source: "builtin" }]);
  }, []);

  /** An AI reply arrived (or failed). Validate → line → emotion → movement → relationship + memory → suggestions. */
  const onAiResult = useCallback(
    (job: AiJob, r: TalkResult) => {
      const cur = ref.current;
      if (!cur || cur.id !== job.sessionId || convo.current.job !== job || cur.phase !== "WAIT_FOR_RESPONSE") return;
      const { cast, getStory, setStoryState, showLines, beatNo, stage, commit } = deps.current;
      const me = cast.find((c) => c.id === job.meId);
      const them = cast.find((c) => c.id === job.themId);
      if (!me || !them) return end("targetLeft");
      if (r.ok) {
        const v = validateReply(r.data.reply, { listener: them, speaker: me, story: getStory(), message: job.text, decision: job.request });
        if (v.dialogue) {
          let next = getStory();
          if (job.request) next = applyDecisionOutcome(next, job.request, them, me, r.data.source === "ai" ? "talk-ai" : "talk-mock").story;
          next = applyReply(next, v, them, me, r.data.source);
          setStoryState(next);
          if (job.request?.endConversation || v.stance === "end_conversation") convo.current.closing = true;
          const e = emotionOf(next.characters[them.id]);
          stage.syncEmotion(them.id, e.emotion, e.level, e.at);
          playMovement(v, me, them);
          job.state = "shown";
          convo.current.beat = beatNo + 1;
          showLines([{ speaker: { kind: "character", name: them.name.trim(), id: them.id }, key: "custom", params: { text: v.dialogue }, source: r.data.source }]);
          deps.current.autonomy?.heard(them.id, v.dialogue);
          set({ ...cur, aiTopics: v.suggestions, replySource: r.data.source, aiError: null, canRetry: false });
          return;
        }
        // The reply broke the game's decision (disclosed, agreed, overclaimed): the decision stands, voiced by the built-in line.
        const own = builtinFor(job.request);
        if (v.rejected && own && job.request) {
          showBoundaryLine(job, me, them, own);
          set({ ...cur, aiTopics: [], replySource: "builtin", aiError: null, canRetry: false });
          return;
        }
        r = { ok: false, code: "invalid_output" };
      }
      if (r.code === "cancelled") return;
      {
        const own = builtinFor(job.request);
        if (own && job.request) {
          // AI failed, but the game already knows what the listener will do: say it with the built-in line.
          showBoundaryLine(job, me, them, own);
          set({ ...cur, aiError: r.code, canRetry: false, replySource: "builtin", aiTopics: [] });
          return;
        }
      }
      if (job.fallback && job.decision) {
        // Suggested topic: show the built-in reaction instead, and say so (never passed off as AI).
        commit(job.decision);
        job.state = "shown";
        convo.current.beat = beatNo + 1;
        showLines(job.fallback);
        set({ ...cur, aiError: r.code, canRetry: false, replySource: "builtin", aiTopics: [] });
        return;
      }
      // Typed message / AI suggestion: no honest built-in answer exists. Say what failed and offer a retry.
      job.state = "failed";
      const failed = { ...cur, aiError: r.code, canRetry: RETRYABLE.has(r.code), aiTopics: [] };
      set(goTo(failed, "CONTINUE_OR_EXIT", nextOptions(failed)));
    },
    [end, set, playMovement, nextOptions, showBoundaryLine],
  );

  /** Ask the AI for the listener's reply. The request goes out now; the answer plays after the speaker's line. */
  const startAi = useCallback(
    (
      s: TalkSession,
      me: Character,
      them: Character,
      o: { text: string; kind: TalkRequest["message"]["kind"]; topic: string | null; decision: Decision | null; fallback: StoryLine[] | null; pre: StoryState; sourceOfLine?: "player" | "ai" | "mock" | "builtin"; request?: RequestDecision | null },
    ) => {
      const d = deps.current;
      const said = convo.current.said;
      const req = buildTalkRequest({
        story: o.pre,
        speaker: me,
        listener: them,
        locale: d.locale,
        world: d.world,
        place: d.place,
        placeDescription: d.placeDescription,
        message: o.text,
        kind: o.kind,
        topic: o.topic,
        decision: o.decision,
        recentEvents: d.recentText(),
        usedTopics: said,
        request: o.request ?? null,
      });
      const now = d.getStory();
      d.setStoryState(pushTalkLine(now, me.id, them.id, { from: me.id, text: o.text, turn: now.turn, at: Date.now(), source: o.sourceOfLine ?? "builtin" }));
      const abort = new AbortController();
      const job: AiJob = { req, abort, promise: sendTalkRequest(req, abort.signal), sessionId: s.id, meId: me.id, themId: them.id, decision: o.decision, fallback: o.fallback, state: "pending", awaited: false, request: o.request ?? null, text: o.text };
      convo.current = { ...emptyConvo(), said: [...said, o.text].slice(-12), job };
    },
    [],
  );

  /** "Try again" after a failed reply (same request; nothing was applied the first time). */
  const retry = useCallback(() => {
    const s = ref.current;
    const job = convo.current.job;
    if (!s || !job || job.state !== "failed" || s.phase !== "CONTINUE_OR_EXIT" || deps.current.lineInProgress) return;
    const abort = new AbortController();
    const nj: AiJob = { ...job, abort, promise: sendTalkRequest(job.req, abort.signal), state: "pending", awaited: true };
    convo.current.job = nj;
    set(goTo(s, "WAIT_FOR_RESPONSE", { aiError: null, canRetry: false }));
    void nj.promise.then((r) => onAiResult(nj, r));
  }, [set, onAiResult]);

  // ---- FACE_TARGET: both turn to each other and stay together, then the options open.
  useEffect(() => {
    if (phase !== "FACE_TARGET") return;
    const s = ref.current!;
    const { stage, autonomy } = deps.current;
    // They ended the last conversation and aren't ready to talk again: no conversation. Asking again can't get round it.
    if (autonomy?.refusesTalk(s.targetId!, s.actorId)) {
      convo.current = emptyConvo();
      set(null);
      autonomy.refused(s.targetId!, s.actorId);
      return;
    }
    autonomy?.talking(s.actorId, s.targetId!);
    stage.request({ type: "face_target", actor: s.actorId, target: s.targetId! }, "conversation", "story");
    stage.request({ type: "face_target", actor: s.targetId!, target: s.actorId }, "conversation", "story");
    stage.beginConversation([s.actorId, s.targetId!]);
    const timer = window.setTimeout(() => {
      const cur = ref.current;
      if (!cur || cur.id !== s.id || cur.phase !== "FACE_TARGET") return;
      const topics = freshTopics(cur);
      set(goTo(cur, "SHOW_OPTIONS", { topics, offered: [...cur.offered, ...topics.map((t) => t.id)] }));
    }, FACE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, freshTopics, set]);

  /** Say one of the suggested topics. */
  const chooseTopic = useCallback(
    (choice: TopicChoice) => {
      const s = ref.current;
      const { cast, getStory, setStoryState, showLines, decideOnly, beatNo, lineInProgress, stage } = deps.current;
      if (!s || !CHOOSING_PHASES.includes(s.phase) || lineInProgress || !s.targetId || aiBusy(convo.current)) return;
      const me = cast.find((c) => c.id === s.actorId);
      const them = cast.find((c) => c.id === s.targetId);
      if (!me || !them) return end("targetLeft");
      const story = getStory();
      const variant = story.turn + s.round;
      setStoryState(applyTopic(story, me, them, choice, variant));
      stage.beginConversation([me.id, them.id]);
      // The listener's answer is decided now (from the updated state) but only plays out when their line comes up.
      const decision = decideOnly({ trigger: choice.trigger, reactorId: them.id, otherId: me.id, interaction: TOPIC_LISTENER_KIND[choice.id] });
      const said: StoryLine = {
        speaker: { kind: "character", name: me.name.trim(), id: me.id },
        key: "tpl",
        tpl: sayKey(choice, toneOf(personalityOf(me)), deps.current.world, deps.current.place),
        index: variant,
        params: { ...choice.vars, other: them.name.trim(), name: me.name.trim() },
        source: "builtin",
      };
      let reply = decision ? decisionLines(decision, cast, variant) : [];
      if (!reply.length) reply = [{ speaker: { kind: "narrator" }, key: "tpl", tpl: "talk.listens", index: variant, params: { other: them.name.trim() }, source: "builtin" }];
      if (deps.current.ai) {
        // AI reply: the speaker's line plays while the listener's answer is being written.
        const text = deps.current.renderText(said);
        startAi(s, me, them, { text, kind: "topic", topic: choice.id, decision, fallback: reply, pre: story });
        convo.current.beat = beatNo + 1;
        showLines([said]);
        set(goTo(s, "SPEAK", { round: s.round + 1, composing: false, aiError: null, canRetry: false }));
        return;
      }
      convo.current = { ...emptyConvo(), said: convo.current.said, beat: beatNo + 1, decision };
      showLines([said, ...reply]);
      set(goTo(s, "SPEAK", { round: s.round + 1, composing: false, aiError: null, canRetry: false, replySource: "builtin", aiTopics: [] }));
    },
    [end, set, startAi],
  );

  /** "Ask something else": open / close the composer. The draft is kept until it is sent. */
  const openComposer = useCallback(() => {
    const s = ref.current;
    if (s && CHOOSING_PHASES.includes(s.phase)) set({ ...s, composing: true });
  }, [set]);
  const closeComposer = useCallback(() => {
    const s = ref.current;
    if (s) set({ ...s, composing: false });
  }, [set]);
  const setDraft = useCallback(
    (draft: string) => {
      const s = ref.current;
      if (s) set({ ...s, draft });
    },
    [set],
  );

  /** Send the typed message: the speaker says it in their bubble; with AI on, the listener answers it. */
  const sendCustom = useCallback(() => {
    const s = ref.current;
    const { cast, getStory, setStoryState, showLines, beatNo, lineInProgress, stage } = deps.current;
    if (!s || !CHOOSING_PHASES.includes(s.phase) || lineInProgress || !s.targetId || aiBusy(convo.current)) return false;
    const text = cleanMessage(s.draft);
    if (!text) return false;
    const me = cast.find((c) => c.id === s.actorId);
    const them = cast.find((c) => c.id === s.targetId);
    if (!me || !them) return false;
    const before = getStory();
    setStoryState(applyCustom(before, me, them));
    stage.beginConversation([me.id, them.id]);
    const line: StoryLine = { speaker: { kind: "character", name: me.name.trim(), id: me.id }, key: "custom", params: { text } };
    // Steps 1–7: what the listener is actually willing to do, decided by the game before any reply is written.
    const request = decideRequest({ story: before, listener: them, speaker: me, text, cast });
    if (deps.current.ai) {
      startAi(s, me, them, { text, kind: "typed", topic: null, decision: null, fallback: null, pre: before, sourceOfLine: "player", request });
      convo.current.beat = beatNo + 1;
    } else if (builtinFor(request)) {
      // No AI: the decision is still enforced, voiced by a built-in line once the speaker has finished.
      convo.current = { ...emptyConvo(), said: [...convo.current.said, text].slice(-12), beat: beatNo + 1, custom: null, job: { req: null as unknown as TalkRequest, abort: new AbortController(), promise: Promise.resolve({ ok: false, code: "not_configured" } as TalkResult), sessionId: s.id, meId: me.id, themId: them.id, decision: null, fallback: null, state: "pending", awaited: true, request, text } };
      pendingBuiltin.current = true;
    } else convo.current = { ...emptyConvo(), said: convo.current.said, beat: beatNo + 1, custom: text };
    showLines([line]);
    set(goTo(s, "SPEAK", { round: s.round + 1, composing: false, draft: "", customPending: false, aiError: null, canRetry: false }));
    return true;
  }, [set, startAi]);

  /** Say one of the AI-written suggestions (the speaker's own next line). */
  const chooseSuggestion = useCallback(
    (sug: TalkSuggestion) => {
      const s = ref.current;
      const { cast, getStory, setStoryState, showLines, beatNo, lineInProgress, stage } = deps.current;
      if (!s || !CHOOSING_PHASES.includes(s.phase) || lineInProgress || !s.targetId || aiBusy(convo.current) || !deps.current.ai) return;
      const me = cast.find((c) => c.id === s.actorId);
      const them = cast.find((c) => c.id === s.targetId);
      if (!me || !them) return end("targetLeft");
      const before = getStory();
      setStoryState(applyCustom(before, me, them));
      stage.beginConversation([me.id, them.id]);
      const src = deps.current.ai === "ai" ? "ai" : "mock";
      const request = decideRequest({ story: before, listener: them, speaker: me, text: sug.line, cast });
      startAi(s, me, them, { text: sug.line, kind: "suggestion", topic: sug.label, decision: null, fallback: null, pre: before, sourceOfLine: src, request });
      convo.current.beat = beatNo + 1;
      showLines([{ speaker: { kind: "character", name: me.name.trim(), id: me.id }, key: "custom", params: { text: sug.line }, source: src }]);
      set(goTo(s, "SPEAK", { round: s.round + 1, composing: false, aiError: null, canRetry: false }));
    },
    [end, set, startAi],
  );

  // ---- SPEAK → WAIT_FOR_RESPONSE → CONTINUE_OR_EXIT, following the dialogue queue.
  const { beatNo, lineIndex, lineInProgress } = d;
  useEffect(() => {
    const s = ref.current;
    if (!s || (s.phase !== "SPEAK" && s.phase !== "WAIT_FOR_RESPONSE")) return;
    const c = convo.current;
    // Our lines are on screen (ours), or something newer replaced them (moved on).
    const ours = beatNo === c.beat;
    const movedOn = beatNo > c.beat;
    const done = (ours && !lineInProgress) || movedOn;
    if (c.job && pendingBuiltin.current) {
      const job = c.job;
      if (s.phase === "SPEAK" && done) {
        pendingBuiltin.current = false;
        set(goTo(s, "WAIT_FOR_RESPONSE"));
        const me = deps.current.cast.find((x) => x.id === job.meId);
        const them = deps.current.cast.find((x) => x.id === job.themId);
        if (me && them) showBoundaryLine(job, me, them, builtinFor(job.request)!);
      }
      return;
    }
    if (c.job) {
      const job = c.job;
      // The listener ended it: once their line has been read, the conversation is over.
      if (s.phase === "WAIT_FOR_RESPONSE" && job.state === "shown" && done && c.closing) {
        end("listenerEnded");
        deps.current.autonomy?.endedConversation(job.themId, job.meId);
        return;
      }
      // The speaker has finished: wait for (or show) the AI's answer.
      if (s.phase === "SPEAK" && done) {
        set(goTo(s, "WAIT_FOR_RESPONSE"));
        deps.current.stage.request({ type: "face_target", actor: job.themId, target: job.meId }, "conversation", "story");
        if (!job.awaited) {
          job.awaited = true;
          void job.promise.then((r) => onAiResult(job, r));
        }
      }
      // The answer has been read: next options.
      if (s.phase === "WAIT_FOR_RESPONSE" && job.state === "shown" && done) set(goTo(s, "CONTINUE_OR_EXIT", nextOptions(s)));
      return;
    }
    if (s.phase === "SPEAK") {
      // Built-in topic: the reply starts when the player moves on to the listener's line.
      if (!c.custom && ((ours && lineIndex >= 1) || movedOn)) {
        if (c.decision) deps.current.commit(c.decision);
        set(goTo(s, "WAIT_FOR_RESPONSE"));
      }
      // Typed message with AI conversations off: nobody can honestly answer it, and the panel says why.
      if (c.custom && done) {
        set(goTo(s, "WAIT_FOR_RESPONSE"));
        deps.current.stage.request({ type: "face_target", actor: s.targetId!, target: s.actorId }, "conversation", "story");
        const next = { ...s, phase: "WAIT_FOR_RESPONSE" as const, customPending: true };
        set(goTo(next, "CONTINUE_OR_EXIT", nextOptions({ ...next, aiTopics: [] })));
      }
      return;
    }
    if (!c.custom && done) set(goTo(s, "CONTINUE_OR_EXIT", { ...nextOptions({ ...s, aiTopics: [] }), customPending: false }));
  }, [session, beatNo, lineIndex, lineInProgress, set, freshTopics, onAiResult, nextOptions, showBoundaryLine, end]);

  // ---- Someone left the stage mid-conversation.
  const castKey = d.cast.map((c) => c.id).join("|");
  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    const ids = castKey.split("|");
    if (!ids.includes(s.actorId) || (s.targetId && !ids.includes(s.targetId))) end("targetLeft");
  }, [castKey, end]);

  return {
    session,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    tell,
    /** A notice with names already written out (objects, places). */
    tellNames: useCallback((kind: TalkNoticeKind, actor: string, other: string) => setNotice({ kind, actor, target: other, at: Date.now() }), []),
    beginSelect,
    startWalk,
    talkHere,
    /** Cancel the target choice or the walk, or end the conversation. */
    cancel: useCallback(() => end(ref.current && TALKING_PHASES.includes(ref.current.phase) ? "ended" : "cancelled"), [end]),
    endConversation: useCallback(() => end("ended"), [end]),
    chooseTopic,
    openComposer,
    closeComposer,
    setDraft,
    sendCustom,
    chooseSuggestion,
    retry,
    /** Is this pair in a walk-and-talk right now (the autonomous "approached" reaction stays out of it)? */
    involves: useCallback((a: string, b: string) => {
      const s = ref.current;
      return !!s && s.phase !== "SELECT_TARGET" && ((s.actorId === a && s.targetId === b) || (s.actorId === b && s.targetId === a));
    }, []),
    active: useCallback(() => !!ref.current, []),
  };
}
