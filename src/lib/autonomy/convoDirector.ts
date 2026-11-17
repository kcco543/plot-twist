/**
 * CONVERSATION DIRECTOR — runs autonomous conversations against the stage.
 * --------------------------------------------------------------------------
 * No React and no timers of its own: step() is called a few times a second
 * by useAutoConversations.ts (tests call it directly with a fake clock).
 *
 * Session timing uses STAGE time (it stops while the game is paused);
 * cooldowns and records use wall-clock time (they survive a reload).
 *
 * The rules it enforces:
 *   - one shared session per conversation; a character belongs to at most
 *     one session (owns()), and nothing else may plan for them meanwhile
 *     (the autonomy engine asks owns() through inConversation);
 *   - while Active / Ending both characters are LOCKED by the stage
 *     (StageSim.lockConversation): no walk of any priority starts;
 *     only a transition out of Active (release) frees them; the player's own
 *     command interrupts the session first (StageSim.onLockedMove);
 *   - the AI is never called by step() itself: one request per accepted
 *     conversation, only when the writer, the hourly cap and the AI pause
 *     allow it; everything routine is local rules;
 *   - nothing in the story changes for a turn until that turn is committed
 *     (shown); relationships and memories change only when the whole
 *     conversation completes;
 *   - every session ends in a final state, its lock released and a record
 *     kept: on completion, decline, interruption, AI error, scene change,
 *     timeout or reload.
 */
import { emotionOf, withEmotion } from "../emotion/emotions";
import { blendProposal, recordInteraction } from "../relationships/progression";
import { INTERACTION_KINDS, type InteractionKind, type Significance } from "../relationships/types";
import { pushTalkLine, rememberNote, validateInteraction } from "../talk/ai/apply";
import type { StageAction, Priority, ActionResult } from "../stage/actions";
import type { WorldObject } from "../stage/objects";
import type { Point } from "../stage/room";
import { neutralState } from "../story/engine";
import type { Character, MemoryKind, StoryLine, StoryState, TextSpeed } from "../types";
import { MEMORY_KINDS } from "../types";
import { agencyOf } from "./lifecycle";
import {
  answerConversation,
  AUTO_CONVO,
  bookOf,
  builtinOutcome,
  builtinPlan,
  chooseStart,
  isFinalState,
  lineMs,
  moveConvo,
  OWNING_STATES,
  pairOf,
  pickLength,
  scorePair,
  turnEmotion,
  type AutoConvo,
  type ConvoAnswer,
  type ConvoBook,
  type ConvoOutcome,
  type ConvoRecord,
  type ConvoSource,
  type ConvoTurn,
  type PlannedTurn,
  type StartCandidate,
} from "./convo";
import type { ConverseErrorCode } from "../talk/ai/converse";
import { frequencySpec, type Frequency } from "./frequency";
import type { AgencyState } from "./types";

/** The slice of StageSim the director uses. */
export type DirectorStage = {
  readonly now: number;
  readonly paused: boolean;
  position: (id: string) => Point | null;
  gapBetween: (a: string, b: string) => number | null;
  walkOf: (id: string) => { kind: string; priority: Priority } | null;
  isCommanded: (id: string) => boolean;
  stateOf: (id: string) => string | null;
  conversationPhase: (id: string) => string;
  usingObjectOf: (id: string) => string | null;
  request: (raw: StageAction, context: "event", priority: Priority) => ActionResult;
  cancelWalk: (id: string) => boolean;
  /** Is there a walkable way for one to get to talking distance of the other? */
  canReach: (actorId: string, targetId: string, distance?: number) => boolean;
  markApproaching: (id: string, targetId: string) => void;
  lockConversation: (sessionId: string, ids: string[]) => boolean;
  releaseConversation: (sessionId: string, holdMs?: number) => void;
  lockOf: (id: string) => string | null;
  syncEmotion: (id: string, emotion: import("../emotion/emotions").Emotion, level: import("../emotion/emotions").EmotionLevel, stamp: number) => void;
};

/** What a writer returns: the planned turns (speaker ids) and the proposed outcome, or why it couldn't. */
export type WriteResult = { ok: true; turns: PlannedTurn[]; outcome: ConvoOutcome; source: ConvoSource } | { ok: false; code: ConverseErrorCode };

export type DirectorDeps = {
  stage: DirectorStage;
  cast: () => Character[];
  objects: () => WorldObject[];
  getStory: () => StoryState;
  setStory: (s: StoryState) => void;
  /** Append lines to the story log (already in story order). */
  log: (lines: StoryLine[]) => void;
  /** The player's own walk-and-talk or a story beat has this character. */
  inPlayerTalk: (id: string) => boolean;
  talkDistance: (a: string, b: string) => number;
  /** "ai" / "mock" when an AI writer is available, null = built-in lines only. */
  writer: () => "ai" | "mock" | null;
  /** Write the conversation with the AI (only called when writer() isn't null and the budget allows). */
  writeAi: (c: AutoConvo, signal: AbortSignal) => Promise<WriteResult>;
  frequency: () => Frequency;
  enabled: () => boolean;
  roomKey: () => string;
  sceneId: () => string;
  sceneName: () => string;
  worldId: () => string | null;
  textSpeed: () => TextSpeed;
  rng: (key: string) => () => number;
  objectName: (id: string) => string;
  renderText: (line: StoryLine) => string;
  /** After a conversation: someone deliberately walks off (an intent through the autonomy engine). */
  depart: (actorId: string, fromId: string) => void;
  /** Wall clock (ms). */
  wall?: () => number;
  onChange?: () => void;
};

const lineOf = (c: AutoConvo, t: { speaker: string; text?: string; tpl?: string; params?: Record<string, string> }, who: Character, source: ConvoSource): StoryLine => ({
  speaker: { kind: "character", name: who.name.trim(), id: who.id },
  key: t.tpl ? "tpl" : "custom",
  ...(t.tpl ? { tpl: t.tpl } : {}),
  params: t.tpl ? (t.params ?? {}) : { text: t.text ?? "" },
  source,
  convo: c.id,
});
const narrator = (c: AutoConvo, tpl: string, params: Record<string, string>): StoryLine => ({ speaker: { kind: "narrator" }, key: "tpl", tpl, params, source: "builtin", convo: c.id });

const SIG_RANK: Record<Significance, number> = { trivial: 0, ordinary: 1, meaningful: 2, major: 3 };
/** Errors after which no AI conversation is tried for a while (the writer falls back to built-in lines). */
const PAUSING: ConverseErrorCode[] = ["billing", "budget", "ai_off", "auth", "not_configured", "limit"];
const AI_PAUSE_MS = 60 * 60_000;

export class ConversationDirector {
  private d: DirectorDeps;
  private sessions: AutoConvo[] = [];
  private writes = new Map<string, AbortController>();
  private answers = new Map<string, ConvoAnswer>();
  private lastConsiderAt = -Infinity;
  private recovered = false;
  private listeners = new Set<() => void>();
  private snap: readonly AutoConvo[] = [];
  /** Requests sent to the AI writer (tests and the debug view). */
  aiRequests = 0;

  constructor(deps: DirectorDeps) {
    this.d = deps;
  }

  setDeps(deps: DirectorDeps) {
    this.d = deps;
  }

  private wall() {
    return this.d.wall ? this.d.wall() : Date.now();
  }

  // ------------------------------------------------------------ subscription (UI)

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;
  private emit() {
    this.snap = [...this.sessions];
    this.listeners.forEach((l) => l());
    this.d.onChange?.();
  }

  // ------------------------------------------------------------ queries

  /** Running sessions (not final). */
  get active(): readonly AutoConvo[] {
    return this.sessions;
  }
  /** The session this character belongs to right now, if any. */
  sessionOf(id: string): AutoConvo | null {
    return this.sessions.find((c) => OWNING_STATES.includes(c.state) && c.participants.includes(id)) ?? null;
  }
  /** Does a session own this character (they must not start anything else)? */
  owns(id: string): boolean {
    return !!this.sessionOf(id);
  }
  involves(a: string, b: string): boolean {
    const s = this.sessionOf(a);
    return !!s && s.participants.includes(b);
  }

  // ------------------------------------------------------------ book (saved with the world)

  private book(): ConvoBook {
    return bookOf(this.d.getStory().agency);
  }
  private writeBook(fn: (b: ConvoBook, s: StoryState) => ConvoBook, story?: StoryState) {
    const s = story ?? this.d.getStory();
    const ag: AgencyState = agencyOf(s.agency);
    const book = fn(bookOf(ag), s);
    this.d.setStory({ ...s, agency: { ...ag, convos: { ...book, active: this.sessions.filter((c) => !isFinalState(c.state)) } } });
  }
  private sync() {
    this.writeBook((b) => b);
  }

  /** After a reload: sessions saved as running can't continue honestly. Close them as interrupted. */
  recover() {
    if (this.recovered) return;
    this.recovered = true;
    const b = this.book();
    // Only sessions this director didn't start (saved by an earlier page) are stale.
    const mine = new Set(this.sessions.map((c) => c.id));
    const stale = b.active.filter((c) => !mine.has(c.id));
    if (!stale.length) return;
    const wall = this.wall();
    const records = stale.map((c) => this.recordOf({ ...c, state: "interrupted", endReason: "reload", endedAt: wall }, [], []));
    this.writeBook((bk) => ({ ...bk, history: [...bk.history, ...records].slice(-AUTO_CONVO.historyLimit) }));
    this.emit();
  }

  // ------------------------------------------------------------ starting

  private available(id: string): boolean {
    const st = this.d.stage;
    return !!st.position(id) && !st.walkOf(id) && !st.isCommanded(id) && st.conversationPhase(id) === "disengaged" && st.stateOf(id) !== "speaking" && !this.d.inPlayerTalk(id) && !this.owns(id);
  }

  private create(cand: StartCandidate, origin: "scheduler" | "planner"): AutoConvo {
    const t = this.d.stage.now;
    const wall = this.wall();
    const story = this.d.getStory();
    const len = pickLength(cand.initiator, cand.target, cand.topic, story, this.d.rng(`${cand.initiator.id}>${cand.target.id}:len:${Math.floor(wall / 1000)}`));
    const c: AutoConvo = {
      id: `convo-${wall.toString(36)}-${Math.floor(this.d.rng(`${cand.initiator.id}:${wall}`)() * 1e6).toString(36)}`,
      worldId: this.d.worldId(),
      sceneId: this.d.sceneId(),
      roomKey: this.d.roomKey(),
      participants: [cand.initiator.id, cand.target.id],
      initiator: cand.initiator.id,
      state: "proposed",
      speaker: null,
      turns: [],
      pending: [],
      topic: cand.topic,
      reason: cand.reason,
      length: len.length,
      minTurns: len.min,
      maxTurns: len.max,
      willingness: null,
      source: null,
      writing: false,
      outcome: null,
      createdAt: wall,
      startedAt: null,
      endedAt: null,
      updatedAt: wall,
      nextAt: t,
      deadline: t,
      hardStop: t + AUTO_CONVO.approachTimeoutMs + AUTO_CONVO.maxDurationMs,
      endReason: null,
      leaver: null,
    };
    void origin;
    this.sessions.push(c);
    this.writeBook((b) => ({ ...b, lastStartAt: wall, pairAt: { ...b.pairAt, [pairOf(c.participants[0], c.participants[1])]: wall } }));
    this.emit();
    return c;
  }

  /**
   * A character's own planner wants to go and talk to someone ("wants
   * company", "seeks comfort"): a conversation session instead of a bare
   * walk. False when it can't happen now (the planner then does something else).
   */
  request(actorId: string, targetId: string): boolean {
    if (!this.recovered) this.recover();
    if (!this.d.enabled() || this.sessions.length >= AUTO_CONVO.maxActive) return false;
    const spec = frequencySpec(this.d.frequency());
    const wall = this.wall();
    const b = this.book();
    if (wall - b.lastStartAt < spec.convoGapMs / 2) return false;
    if (wall - (b.pairAt[pairOf(actorId, targetId)] ?? -Infinity) < spec.pairGapMs) return false;
    if (wall - (b.lastAt[actorId] ?? -Infinity) < spec.charGapMs || wall - (b.lastAt[targetId] ?? -Infinity) < spec.charGapMs) return false;
    const cast = this.d.cast();
    const a = cast.find((c) => c.id === actorId);
    const t = cast.find((c) => c.id === targetId);
    if (!a || !t || !this.available(actorId) || this.owns(targetId) || this.d.inPlayerTalk(targetId) || !this.d.stage.position(targetId)) return false;
    const tw = this.d.stage.walkOf(targetId);
    if (tw && tw.priority !== "auto") return false;
    const cand = scorePair(a, t, this.startCtx());
    if (!cand || !this.reachable(actorId, targetId)) return false;
    this.create(cand, "planner");
    return true;
  }

  private startCtx() {
    const st = this.d.stage;
    return { story: this.d.getStory(), agency: agencyOf(this.d.getStory().agency), objects: this.d.objects(), position: (id: string) => st.position(id), now: this.wall(), rng: this.d.rng(`start:${Math.floor(this.wall() / 3000)}`) };
  }

  /** The scheduler: is there a conversation worth starting now? Local rules only. */
  private consider(t: number) {
    if (!this.d.enabled() || this.sessions.length >= AUTO_CONVO.maxActive) return;
    const spec = frequencySpec(this.d.frequency());
    if (t - this.lastConsiderAt < spec.considerMs) return;
    this.lastConsiderAt = t;
    const wall = this.wall();
    const b = this.book();
    if (wall - b.lastStartAt < spec.convoGapMs) return;
    const cand = chooseStart(this.d.cast(), (id) => this.available(id), { ...this.startCtx(), book: b, charGapMs: spec.charGapMs, pairGapMs: spec.pairGapMs, initiative: spec.initiative });
    if (!cand) return;
    if (!this.reachable(cand.initiator.id, cand.target.id)) {
      // No way over there right now (furniture, a crowd): don't propose it, and let another pair have the next turn.
      const pair = pairOf(cand.initiator.id, cand.target.id);
      this.writeBook((bk) => ({ ...bk, pairAt: { ...bk.pairAt, [pair]: wall - spec.pairGapMs + spec.convoGapMs } }));
      return;
    }
    this.create(cand, "scheduler");
  }

  private reachable(a: string, b: string): boolean {
    const st = this.d.stage;
    const dist = this.d.talkDistance(a, b);
    return (st.gapBetween(a, b) ?? Infinity) <= dist + AUTO_CONVO.talkSlack || st.canReach(a, b, dist);
  }

  // ------------------------------------------------------------ the loop

  /** One step: advance every session, then maybe start one. Cheap; never calls an AI directly. */
  step() {
    const st = this.d.stage;
    if (!this.recovered) this.recover();
    if (st.paused) return;
    const t = st.now;
    for (const c of [...this.sessions]) this.advance(c, t);
    this.consider(t);
  }

  private put(c: AutoConvo) {
    this.sessions = this.sessions.map((x) => (x.id === c.id ? c : x));
  }

  private castOf(id: string) {
    return this.d.cast().find((c) => c.id === id) ?? null;
  }

  /** Is this session still possible? Returns the reason it isn't. */
  private broken(c: AutoConvo): string | null {
    const st = this.d.stage;
    if (this.d.roomKey() !== c.roomKey) return "scene_change";
    for (const id of c.participants) {
      if (!st.position(id) || !this.castOf(id)) return "left";
      if (this.d.inPlayerTalk(id)) return "player";
      if ((c.state === "active" || c.state === "ending") && st.lockOf(id) !== c.id) return "lock_lost";
    }
    return null;
  }

  private advance(c0: AutoConvo, t: number) {
    const c = this.sessions.find((x) => x.id === c0.id);
    if (!c) return;
    const why = this.broken(c);
    if (why) return this.interrupt(c.id, why);
    const st = this.d.stage;
    const [a, b] = c.participants;
    const dist = this.d.talkDistance(a, b);
    const close = () => (st.gapBetween(a, b) ?? Infinity) <= dist + AUTO_CONVO.talkSlack;
    // B holds still while A comes over (their own routine walks are dropped).
    const holdB = () => {
      const w = st.walkOf(b);
      if (w && w.priority === "auto") st.cancelWalk(b);
    };
    switch (c.state) {
      case "proposed": {
        holdB();
        const w = st.walkOf(b);
        if (w) return this.interrupt(c.id, "busy");
        if (close()) {
          st.request({ type: "face_target", actor: a, target: b }, "event", "story");
          this.put(moveConvo(c, "awaiting", this.wall(), { nextAt: t + AUTO_CONVO.awaitMs }));
          return this.changed();
        }
        const res = st.request({ type: "approach", actor: a, target: b, distance: dist }, "event", "story");
        if (!res.ok) return this.interrupt(c.id, "unreachable");
        st.markApproaching(a, b);
        this.put(moveConvo(c, st.walkOf(a) ? "approaching" : "awaiting", this.wall(), { nextAt: t + AUTO_CONVO.awaitMs, deadline: t + AUTO_CONVO.approachTimeoutMs }));
        return this.changed();
      }
      case "approaching": {
        holdB();
        if (st.walkOf(a)) {
          if (t > c.deadline) {
            st.cancelWalk(a);
            return this.interrupt(c.id, "timeout");
          }
          return;
        }
        if (!close()) return this.interrupt(c.id, "unreachable");
        st.request({ type: "face_target", actor: b, target: a }, "event", "story");
        this.put(moveConvo(c, "awaiting", this.wall(), { nextAt: t + AUTO_CONVO.awaitMs }));
        return this.changed();
      }
      case "awaiting": {
        if (t < c.nextAt) return;
        const ans = this.answers.get(c.id);
        if (ans && !ans.accept) return this.finishDecline(c);
        if (!ans) return this.answer(c, t);
        return;
      }
      case "active": {
        if (t > c.hardStop) return this.interrupt(c.id, "too_long");
        if (c.writing) {
          if (t > c.deadline) return this.interrupt(c.id, "timeout");
          return;
        }
        if (t < c.nextAt) return;
        if (c.pending.length) return this.commitTurn(c, t);
        this.put(moveConvo(c, "ending", this.wall(), { speaker: null, nextAt: t + AUTO_CONVO.endingMs }));
        return this.changed();
      }
      case "ending": {
        if (t < c.nextAt) return;
        return this.complete(c);
      }
    }
  }

  private changed() {
    this.sync();
    this.emit();
  }

  // ------------------------------------------------------------ B answers

  private answer(c: AutoConvo, t: number) {
    const st = this.d.stage;
    const [aId, bId] = c.participants;
    const a = this.castOf(aId)!;
    const b = this.castOf(bId)!;
    const story = this.d.getStory();
    const ans = answerConversation(story, agencyOf(story.agency), b, a, { busyWith: st.usingObjectOf(bId), topic: c.topic, rng: this.d.rng(`${c.id}:answer`), now: this.wall() });
    this.answers.set(c.id, ans);
    st.request({ type: "face_target", actor: bId, target: aId }, "event", "story");
    if (!ans.accept) {
      // B says no (a built-in line: it's a decision, not something the AI needs to invent).
      const v = Math.floor(this.d.rng(`${c.id}:decline`)() * 3) % 3;
      const turn: ConvoTurn = { speaker: bId, tpl: `autoTalk.builtin.decline.${ans.why}.${v}`, params: { a: a.name.trim(), b: b.name.trim() }, emotion: ans.why === "notWithYou" ? "frustrated" : ans.why === "shy" ? "embarrassed" : "neutral", level: 1, at: this.wall() };
      this.d.log([lineOf(c, turn, b, "builtin")]);
      const text = this.d.renderText(lineOf(c, turn, b, "builtin"));
      this.put({ ...c, turns: [turn], speaker: bId, nextAt: t + lineMs(text, this.d.textSpeed()), updatedAt: this.wall() });
      return this.changed();
    }
    // Yes: one shared session, both locked in place, facing each other.
    if (!st.lockConversation(c.id, [aId, bId])) return this.interrupt(c.id, "busy");
    const active = moveConvo(c, "active", this.wall(), { willingness: ans.willingness, nextAt: t + AUTO_CONVO.openMs, hardStop: t + AUTO_CONVO.maxDurationMs });
    this.put(active);
    this.startWriting(active, a, b, t);
    this.changed();
  }

  private finishDecline(c: AutoConvo) {
    const st = this.d.stage;
    const [aId, bId] = c.participants;
    const ans = this.answers.get(c.id);
    // A takes it in stride: a glance away, then back to their own things.
    st.request({ type: "idle_reaction", actor: aId, kind: "look_around" }, "event", "auto");
    const done = moveConvo(c, "declined", this.wall(), { endReason: `declined_${ans?.why ?? "notNow"}` });
    this.answers.delete(c.id);
    this.finalize(done, [], []);
    const wall = this.wall();
    this.writeBook((b) => ({ ...b, lastAt: { ...b.lastAt, [aId]: wall, [bId]: wall } }));
    this.emit();
  }

  // ------------------------------------------------------------ writing the lines

  private aiAllowed(): boolean {
    if (!this.d.writer()) return false;
    const spec = frequencySpec(this.d.frequency());
    const b = this.book();
    const wall = this.wall();
    if (wall < b.ai.offUntil) return false;
    const inWindow = wall - b.ai.windowStart < 60 * 60_000;
    return !inWindow || b.ai.count < spec.aiPerHour;
  }

  private startWriting(c: AutoConvo, a: Character, b: Character, t: number) {
    if (!this.aiAllowed()) {
      // Built-in lines, clearly labelled (no AI writer, or the hourly cap / an AI pause is in effect).
      const objName = c.topic.object ? this.d.objectName(c.topic.object) : "";
      const turns = builtinPlan(a, b, c.topic, objName, this.d.rng(`${c.id}:builtin`)).slice(0, c.maxTurns);
      this.put({ ...this.sessions.find((x) => x.id === c.id)!, pending: turns, outcome: builtinOutcome(a, b, c.topic), source: "builtin", writing: false });
      return;
    }
    if (this.writes.has(c.id)) return; // one request per session, ever
    const wall = this.wall();
    this.writeBook((bk) => {
      const fresh = wall - bk.ai.windowStart >= 60 * 60_000;
      return { ...bk, ai: { ...bk.ai, windowStart: fresh ? wall : bk.ai.windowStart, count: (fresh ? 0 : bk.ai.count) + 1 } };
    });
    const ctrl = new AbortController();
    this.writes.set(c.id, ctrl);
    this.aiRequests++;
    this.put({ ...this.sessions.find((x) => x.id === c.id)!, writing: true, deadline: t + AUTO_CONVO.writeTimeoutMs });
    void this.d.writeAi(c, ctrl.signal).then(
      (r) => this.written(c.id, r),
      () => this.written(c.id, { ok: false, code: "failed" }),
    );
  }

  private written(id: string, r: WriteResult) {
    const ctrl = this.writes.get(id);
    if (!ctrl || ctrl.signal.aborted) return;
    const c = this.sessions.find((x) => x.id === id);
    if (!c || c.state !== "active") return;
    if (!r.ok) {
      if (PAUSING.includes(r.code)) {
        const wall = this.wall();
        this.writeBook((bk) => ({ ...bk, ai: { ...bk.ai, offUntil: wall + AI_PAUSE_MS, offReason: r.code } }));
      }
      // Stop gracefully: no invented lines pretending to be AI.
      return this.interrupt(id, `ai_${r.code}`);
    }
    const turns = r.turns.slice(0, Math.min(c.maxTurns, AUTO_CONVO.maxTurns));
    if (turns.length < 2) return this.interrupt(id, "ai_invalid_output");
    this.put({ ...c, pending: turns, outcome: r.outcome, source: r.source, writing: false });
    this.changed();
  }

  // ------------------------------------------------------------ committing a turn

  private commitTurn(c: AutoConvo, t: number) {
    const [next, ...rest] = c.pending;
    const who = this.castOf(next.speaker);
    const other = this.castOf(c.participants.find((x) => x !== next.speaker)!);
    if (!who || !other) return this.interrupt(c.id, "left");
    const source = c.source ?? "builtin";
    let story = this.d.getStory();
    const em = turnEmotion(who, story, next);
    const wall = this.wall();
    const turn: ConvoTurn = { speaker: who.id, ...(next.tpl ? { tpl: next.tpl, params: next.params } : { text: next.text }), emotion: em.emotion, level: em.level, at: wall };
    const line = lineOf(c, turn, who, source);
    const text = this.d.renderText(line);
    // The turn is committed: its emotion shows, and it joins the pair's conversation history.
    const s0 = story.characters[who.id] ?? neutralState();
    story = { ...story, characters: { ...story.characters, [who.id]: em.level === 0 ? withEmotion(s0, "neutral", 0, wall) : withEmotion(s0, em.emotion, em.level, wall) } };
    story = pushTalkLine(story, who.id, other.id, { from: who.id, text, turn: story.turn, at: wall, source: source === "builtin" ? "builtin" : source });
    const e = emotionOf(story.characters[who.id]);
    this.d.stage.syncEmotion(who.id, e.emotion, e.level, e.at);
    const updated: AutoConvo = { ...c, pending: rest, turns: [...c.turns, turn], speaker: who.id, nextAt: t + lineMs(text, this.d.textSpeed()) + AUTO_CONVO.lineGapMs, updatedAt: wall };
    this.put(updated);
    this.writeBook((b) => b, story);
    this.d.log([line]);
    this.emit();
  }

  // ------------------------------------------------------------ ending

  private complete(c: AutoConvo) {
    const [aId, bId] = c.participants;
    const a = this.castOf(aId);
    const b = this.castOf(bId);
    if (!a || !b) return this.interrupt(c.id, "left");
    // Consequences only now that every line has actually been said.
    const { story, changes, memories } = this.applyOutcome(this.d.getStory(), c, a, b);
    const outcome = c.outcome;
    const leaver = outcome?.how === "walks_off" && outcome.endedBy && c.participants.includes(outcome.endedBy) ? outcome.endedBy : null;
    const done = moveConvo(c, "completed", this.wall(), { endReason: leaver ? "walkedOff" : "natural", leaver });
    this.d.stage.releaseConversation(c.id, AUTO_CONVO.releaseHoldMs);
    this.finalize(done, changes, memories, story);
    if (leaver) this.d.depart(leaver, leaver === aId ? bId : aId);
  }

  /** End a session early (the player stepped in, scene change, error, timeout). Safe to call twice. */
  interrupt(id: string, reason: string) {
    const c = this.sessions.find((x) => x.id === id);
    if (!c) return;
    const ctrl = this.writes.get(id);
    if (ctrl) ctrl.abort();
    this.d.stage.releaseConversation(id, reason === "player" ? 0 : AUTO_CONVO.releaseHoldMs);
    // A walk over that was under way stops (nothing is left heading for a conversation that isn't happening).
    if (c.state === "approaching" && this.d.stage.walkOf(c.initiator)?.kind === "approach" && reason !== "player") this.d.stage.cancelWalk(c.initiator);
    const done = moveConvo(c, "interrupted", this.wall(), { endReason: reason });
    if (c.turns.length && reason !== "scene_change") {
      const [a, b] = c.participants.map((x) => this.castOf(x)?.name.trim() ?? "");
      this.d.log([narrator(c, reason.startsWith("ai_") ? "autoTalk.log.aiStopped" : "autoTalk.log.cutShort", { a, b })]);
    } else if (reason.startsWith("ai_")) {
      const [a, b] = c.participants.map((x) => this.castOf(x)?.name.trim() ?? "");
      this.d.log([narrator(c, "autoTalk.log.aiStopped", { a, b })]);
    }
    this.finalize(done, [], []);
  }

  /** Interrupt whatever session this character is in (the player took over). */
  interruptFor(characterId: string, reason = "player") {
    const s = this.sessionOf(characterId);
    if (s) this.interrupt(s.id, reason);
  }

  /** Scene change / unmount: end everything running. */
  interruptAll(reason: string) {
    for (const c of [...this.sessions]) this.interrupt(c.id, reason);
  }

  private finalize(done: AutoConvo, changes: ConvoRecord["changes"], memories: ConvoRecord["memories"], story?: StoryState) {
    this.writes.delete(done.id);
    this.answers.delete(done.id);
    this.sessions = this.sessions.filter((x) => x.id !== done.id);
    const rec = this.recordOf(done, changes, memories);
    const wall = this.wall();
    this.writeBook(
      (b) => ({
        ...b,
        history: [...b.history, rec].slice(-AUTO_CONVO.historyLimit),
        lastAt: done.state === "completed" || done.turns.length ? { ...b.lastAt, [done.participants[0]]: wall, [done.participants[1]]: wall } : b.lastAt,
      }),
      story,
    );
    this.emit();
  }

  private recordOf(c: AutoConvo, changes: ConvoRecord["changes"], memories: ConvoRecord["memories"]): ConvoRecord {
    const names = c.participants.map((id) => this.castOf(id)?.name.trim() ?? "") as [string, string];
    return {
      id: c.id,
      participants: c.participants,
      names,
      initiator: c.initiator,
      sceneId: c.sceneId,
      place: this.d.sceneName(),
      status: c.state === "completed" ? "completed" : c.state === "declined" ? "declined" : "interrupted",
      endReason: c.endReason,
      reason: c.reason,
      topic: c.outcome?.topic || c.topic.about,
      source: c.source,
      startedAt: c.createdAt,
      endedAt: c.endedAt ?? this.wall(),
      turns: c.turns,
      changes,
      memories,
      leaver: c.leaver,
    };
  }

  /**
   * The game decides what the conversation changed: the AI's take-aways are
   * proposals. Kinds are checked against the words actually said, nothing is
   * ever "major", "meaningful" needs a real exchange (6+ turns), numbers are
   * capped, and the relationship progression rules keep it gradual. Ordinary
   * chat leaves no long-term memory (the transcript is in the Story Log).
   */
  applyOutcome(story0: StoryState, c: AutoConvo, a: Character, b: Character): { story: StoryState; changes: ConvoRecord["changes"]; memories: ConvoRecord["memories"] } {
    let story = story0;
    const changes: ConvoRecord["changes"] = [];
    const memories: ConvoRecord["memories"] = [];
    const out = c.outcome;
    if (!out || c.turns.length < 2) return { story, changes, memories };
    const src = c.source ?? "builtin";
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const v = out.views[me.id];
      if (!v) continue;
      const said = c.turns
        .filter((t) => t.speaker === other.id)
        .map((t) => t.text ?? "")
        .join(" ");
      const raw = (INTERACTION_KINDS as readonly string[]).includes(v.interaction) ? (v.interaction as InteractionKind) : null;
      const val = src === "builtin" ? { kind: "small_talk" as InteractionKind, proposedKind: "small_talk" as InteractionKind, significance: "ordinary" as Significance, reasons: ["auto:builtin"] } : validateInteraction({ interpretation: { interaction: raw ?? "none", significance: v.significance, evidence: "" } }, said);
      let sig = val.significance;
      const cap: Significance = c.turns.length >= 6 ? "meaningful" : "ordinary";
      if (SIG_RANK[sig] > SIG_RANK[cap]) {
        sig = cap;
        val.reasons.push("auto:significance_cap");
      }
      const { proposed } = blendProposal(val.kind, { trust: v.delta.trust, affection: v.delta.affection, respect: v.delta.respect, tension: v.delta.tension }, sig);
      const res = recordInteraction(story, { from: me, to: other, kind: val.kind, proposedKind: val.proposedKind, significance: sig, proposed, source: "auto-talk", why: (out.topic || c.topic.about).slice(0, 140), reasons: val.reasons, now: this.wall() });
      story = res.story;
      const acc = res.change?.accepted ?? {};
      const delta = Object.fromEntries(Object.entries(acc).filter(([k, x]) => ["trust", "affection", "respect", "familiarity", "tension"].includes(k) && x)) as ConvoRecord["changes"][number]["delta"];
      if (Object.keys(delta).length) changes.push({ from: me.id, to: other.id, delta, kind: val.kind });
      // Long-term memory only for something notable (importance 2); ordinary chat lives in the transcript.
      const m = v.memory;
      if (m && m.importance >= 2 && m.summary.trim() && src !== "builtin") {
        const kind = (MEMORY_KINDS as readonly string[]).includes(m.kind) ? (m.kind as MemoryKind) : null;
        const thread = m.thread === "conflict" || m.thread === "promise" || m.thread === "discovery" || m.thread === "secret" ? m.thread : null;
        story = rememberNote(story, me, other, { kind, importance: 2, note: m.summary.trim(), thread }, m.summary.trim(), src === "mock" ? "mock" : "ai", this.wall());
        memories.push({ holder: me.id, note: m.summary.trim(), importance: 2 });
      }
    }
    return { story, changes, memories };
  }
}

/** Map an AI reply (speakers "a"/"b") to planned turns and an outcome for this session. Exported for tests. */
export function planFromReply(c: AutoConvo, reply: import("../talk/ai/converse").ConverseReply): { turns: PlannedTurn[]; outcome: ConvoOutcome } {
  const [aId, bId] = c.participants;
  const id = (s: "a" | "b") => (s === "a" ? aId : bId);
  const view = (v: import("../talk/ai/converse").ConverseReply["a"]) => ({
    interaction: v.interaction,
    significance: v.significance,
    delta: { trust: v.trust, affection: v.affection, respect: v.respect, tension: v.tension },
    memory: v.memory.importance > 0 && v.memory.summary ? { summary: v.memory.summary, importance: v.memory.importance, kind: v.memory.kind, thread: v.memory.thread } : null,
  });
  return {
    turns: reply.turns.map((t) => ({ speaker: id(t.speaker), text: t.text, emotion: t.emotion, intensity: t.intensity })),
    outcome: { endedBy: id(reply.endedBy), how: reply.how, topic: reply.topic, views: { [aId]: view(reply.a), [bId]: view(reply.b) } },
  };
}
