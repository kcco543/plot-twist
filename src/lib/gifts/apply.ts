/**
 * GIFTS IN THE WORLD — the game engine side.
 * --------------------------------------------------------------------------
 * The AI proposes (contract.ts); these rules decide and record:
 *
 *   transfer      checkTransfer(): the item must belong to this world save,
 *                 the recipient must be one of its characters, and they can't
 *                 already own the same gift.
 *   reaction      validateGiftReply(): canon ("never accepts gifts") forces a
 *                 refusal; a shrug never goes on display; reserved / secretive
 *                 characters keep things private instead of displaying them;
 *                 a display spot must be free; at most CARRY_MAX carried items.
 *                 Emotion uses the same rules as conversations; movement is
 *                 one of a few small moves, run through the stage validator.
 *   recording     giveGift(): the world-specific instance (owner, where it
 *                 is, interpretation, history, who knows about it), the
 *                 recipient's memory, emotion and bond with the player.
 *   autonomy      giftAutonomy(): plain rules, run once per story turn (never
 *                 every frame, never AI): characters put gifts on show, take
 *                 them down, hide or bring them out as their feelings change.
 *   knowledge     who knows a gift exists is tracked separately from where it
 *                 is: displayed gifts are seen by everyone present; carried
 *                 ones by people who spend time talking with the owner; private
 *                 and hidden ones only by the owner.
 */
import { withEmotion, type Emotion, type EmotionLevel } from "../emotion/emotions";
import { canonLimits, personalityOf } from "../mind/profile";
import { bondWithPlayer, neutralBond, PHOTO_STEP, STRONG_BOND } from "../photo/apply";
import type { PhotoMove } from "../photo/contract";
import type { RoomLayout } from "../stage/room";
import { neutralState } from "../story/engine";
import { checkEmotion } from "../talk/ai/apply";
import { PLAYER_ID, type Character, type GiftDisplay, type GiftInstance, type Memory, type StoryState } from "../types";
import type { GiftDecision, GiftReactionReply } from "./contract";

/** Visible display spots per scene. */
export const DISPLAY_MAX = 3;
/** Things one character carries at most. */
export const CARRY_MAX = 3;
/** Turns between two autonomous moves of the same gift. */
export const MOVE_COOLDOWN = 3;
/** Memories kept per character (same cap as conversations and photos). */
const MEMORY_KEEP = 24;

const WARM: Emotion[] = ["happy", "excited", "affectionate"];
const UNEASY: Emotion[] = ["anxious", "sad", "angry", "frustrated"];

// ---------------------------------------------------------------- display spots

export type DisplaySpot = { id: string; x: number; y: number };

/**
 * Where gifts can be shown: on top of the scene's furniture / props (the
 * widest few), so a displayed gift never stands on the floor where people
 * walk. Positions are in stage art pixels (feet coordinates).
 */
export function displaySpots(room: RoomLayout): DisplaySpot[] {
  return [...room.obstacles]
    .sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))
    .slice(0, DISPLAY_MAX)
    .map((o) => ({ id: o.id, x: Math.round((o.x0 + o.x1) / 2), y: o.y0 + 2 }))
    .sort((a, b) => a.x - b.x);
}

export const giftsOf = (story: StoryState): GiftInstance[] => Object.values(story.gifts ?? {}).sort((a, b) => a.receivedAt - b.receivedAt);
export const ownedBy = (story: StoryState, id: string) => giftsOf(story).filter((g) => g.owner === id);
export const displayedGifts = (story: StoryState) => giftsOf(story).filter((g) => g.display === "displayed");
export const freeSpotCount = (story: StoryState, spots: number) => Math.max(0, spots - displayedGifts(story).length);

/** Displayed gifts placed on the scene's spots (oldest first; extra ones aren't drawn). */
export function placeDisplayed(story: StoryState, spots: DisplaySpot[]): { gift: GiftInstance; spot: DisplaySpot }[] {
  return displayedGifts(story)
    .slice(0, spots.length)
    .map((gift, i) => ({ gift, spot: spots[i] }));
}

// ---------------------------------------------------------------- transfer

export type TransferProblem = "not_in_world" | "unknown_character" | "already_has" | "no_name";

export function checkTransfer(story: StoryState, item: { id: string; worldId: string; name: string }, recipientId: string, ctx: { worldId: string | null; cast: Character[] }): TransferProblem | null {
  if (!ctx.worldId || item.worldId !== ctx.worldId) return "not_in_world";
  if (!ctx.cast.some((c) => c.id === recipientId)) return "unknown_character";
  if (!item.name.trim()) return "no_name";
  if (giftsOf(story).some((g) => g.itemId === item.id && g.owner === recipientId)) return "already_has";
  return null;
}

// ---------------------------------------------------------------- reaction

export type ValidatedGift = {
  decision: GiftDecision;
  display: GiftDisplay;
  dialogue: string;
  question: string;
  interpretation: string;
  keepReason: string;
  emotion: Emotion;
  level: 0 | EmotionLevel;
  move: PhotoMove;
  bond: { trust: number; affection: number };
  memory: { note: string; significance: string; importance: number };
  adjustments: string[];
};

export function validateGiftReply(reply: GiftReactionReply, character: Character, story: StoryState, ctx: { freeSpots: number }): ValidatedGift {
  const adjustments: string[] = [];
  const canon = canonLimits(character);
  const p = personalityOf(character);
  const bond = bondWithPlayer(story, character.id);
  const { emotion, level } = checkEmotion(character, story, reply.emotion, reply.intensity, adjustments);

  let decision: GiftDecision = reply.decision;
  if (decision !== "refuse" && canon.banned.has("accept_gift")) {
    decision = "refuse";
    adjustments.push("decision:canon_refuses_gifts");
  }

  let display: GiftDisplay = decision === "refuse" ? "refused" : reply.keep;
  if (decision === "indifferent" && display === "displayed") {
    display = "stored";
    adjustments.push("display:indifferent_not_shown");
  }
  if (display === "displayed" && (p.reserved >= 0.65 || p.hides > 0)) {
    display = "private";
    adjustments.push("display:reserved_keeps_private");
  }
  if (display === "displayed" && ctx.freeSpots <= 0) {
    display = "carried";
    adjustments.push("display:no_free_spot");
  }
  if (display === "carried" && ownedBy(story, character.id).filter((g) => g.display === "carried").length >= CARRY_MAX) {
    display = "private";
    adjustments.push("display:hands_full");
  }

  const nudge = (key: "trust" | "affection") => {
    let d = Math.round(Number.isFinite(reply.relationshipChanges[key]) ? reply.relationshipChanges[key] : 0);
    if (Math.abs(d) > PHOTO_STEP) {
      d = Math.sign(d) * PHOTO_STEP;
      adjustments.push(`bond:${key}_step_cap`);
    }
    if ((bond[key] >= STRONG_BOND && d < -1) || (bond[key] <= -STRONG_BOND && d > 1)) {
      d = Math.sign(d);
      adjustments.push(`bond:${key}_reversal_guard`);
    }
    if (decision === "refuse" && d > 0 && key === "affection") {
      d = 0;
      adjustments.push("bond:no_warmth_from_refusal");
    }
    return d;
  };

  let move: PhotoMove = reply.movementIntent;
  if (move === "step_back" && canon.banned.has("retreat")) {
    move = "none";
    adjustments.push("movement:canon_no_retreat");
  }
  if (move === "hop" && (!WARM.includes(emotion) || decision === "refuse")) {
    move = UNEASY.includes(emotion) ? "fidget" : "none";
    adjustments.push("movement:hop_without_joy");
  }

  return {
    decision,
    display,
    dialogue: reply.dialogue.trim(),
    question: reply.followUpQuestion.trim(),
    interpretation: reply.interpretation.trim(),
    keepReason: reply.keepReason.trim(),
    emotion,
    level,
    move,
    bond: { trust: nudge("trust"), affection: nudge("affection") },
    memory: { note: reply.memory.summary.trim() || reply.interpretation.trim(), significance: reply.memory.significance.trim(), importance: Math.max(1, Math.min(3, Math.round(reply.memory.importance) || 1)) },
    adjustments,
  };
}

// ---------------------------------------------------------------- recording

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const newId = (prefix: string, now: number) => `${prefix}-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Who learns about a gift when it is put somewhere new. */
function learn(g: GiftInstance, display: GiftDisplay, present: string[]): string[] {
  const known = new Set([...g.knownBy, g.recipient]);
  if (display === "displayed") present.forEach((id) => known.add(id));
  return [...known];
}

/**
 * Record a gift the player gave: the world-specific instance, the
 * recipient's memory (gifts are always remembered), emotion and bond.
 * `present` = characters on the stage (they see a gift put on display).
 */
export function giveGift(
  story: StoryState,
  item: { id: string; name: string; description: string; image: string | null },
  character: Character,
  v: ValidatedGift,
  source: "ai" | "mock",
  present: string[],
  now = Date.now(),
): { story: StoryState; instanceId: string } {
  const id = newId("gift", now);
  const refused = v.display === "refused";
  const base: GiftInstance = {
    id,
    itemId: item.id,
    name: item.name,
    description: item.description,
    image: item.image,
    creator: PLAYER_ID,
    owner: refused ? PLAYER_ID : character.id,
    recipient: character.id,
    receivedAt: now,
    receivedTurn: story.turn,
    interpretation: v.interpretation,
    significance: v.memory.significance,
    importance: v.memory.importance,
    display: v.display,
    knownBy: [character.id],
    history: [
      { at: now, turn: story.turn, kind: "given", by: PLAYER_ID },
      refused ? { at: now, turn: story.turn, kind: "refused", by: character.id, why: v.keepReason } : { at: now, turn: story.turn, kind: "accepted", display: v.display, by: character.id, why: v.keepReason },
    ],
  };
  const inst: GiftInstance = { ...base, knownBy: learn(base, v.display, present) };

  const st = story.characters[character.id] ?? neutralState();
  const withFace = v.level === 0 ? withEmotion(st, "neutral", 0, now) : withEmotion(st, v.emotion, v.level, now);
  const mem: Memory = {
    id: newId("mem", now),
    turn: story.turn,
    eventType: refused ? "gift.refused" : "gift.received",
    count: 1,
    reaction: null,
    withId: PLAYER_ID,
    withName: "",
    mood: st.mood,
    importance: v.memory.importance,
    note: v.memory.note,
    at: now,
    source,
    gift: { instanceId: id, name: item.name, interpretation: v.interpretation },
  };
  const b = story.player?.[character.id] ?? neutralBond();
  const bond = {
    ...b,
    trust: clamp(b.trust + v.bond.trust, -100, 100),
    affection: clamp(b.affection + v.bond.affection, -100, 100),
    familiarity: clamp(b.familiarity + 2, 0, 100),
    gifts: (b.gifts ?? 0) + 1,
  };
  return {
    instanceId: id,
    story: {
      ...story,
      characters: { ...story.characters, [character.id]: { ...withFace, memories: [...withFace.memories, mem].slice(-MEMORY_KEEP) } },
      player: { ...(story.player ?? {}), [character.id]: bond },
      gifts: { ...(story.gifts ?? {}), [id]: inst },
    },
  };
}

/** Move a gift somewhere else (by its owner), recording why and who now knows about it. */
export function moveGift(story: StoryState, id: string, display: Exclude<GiftDisplay, "refused">, why: string, present: string[], now = Date.now()): StoryState {
  const g = story.gifts?.[id];
  if (!g || g.owner === PLAYER_ID || g.display === display) return story;
  const next: GiftInstance = { ...g, display, knownBy: learn(g, display, present), history: [...g.history, { at: now, turn: story.turn, kind: "moved" as const, display, by: g.owner, why }].slice(-12) };
  return { ...story, gifts: { ...story.gifts, [id]: next } };
}

/** The player removes a gift from this world (the gift-box item stays). Memories keep their text. */
export function forgetGift(story: StoryState, id: string): StoryState {
  if (!story.gifts?.[id]) return story;
  const { [id]: _gone, ...rest } = story.gifts;
  void _gone;
  return { ...story, gifts: rest };
}

// ---------------------------------------------------------------- autonomy (rules, once per turn)

export type GiftMove = { id: string; owner: string; from: GiftDisplay; to: GiftDisplay; why: GiftMoveReason };
export type GiftMoveReason = "proud" | "fond" | "cooled" | "guarded" | "opened_up" | "treasured" | "seen_talking";

const lastMoveTurn = (g: GiftInstance) => Math.max(g.receivedTurn, ...g.history.filter((h) => h.kind === "moved").map((h) => h.turn));

/**
 * How characters handle their gifts as their feelings change. Deterministic
 * rules, at most one move per character per call (call once per story turn):
 *   carried / private → displayed  when they're fond of the visitor (affection ≥ 40), not reserved, a spot is free
 *   displayed → stored             when they've cooled on the visitor (affection ≤ −20)
 *   private → hidden               when they distrust the visitor (trust ≤ −20)
 *   hidden → private               when trust has grown (≥ 40)
 *   stored → carried               when it mattered (importance ≥ 2) and they're fond (affection ≥ 50)
 * Plus knowledge: someone who has talked with the owner learns about a carried gift.
 */
export function giftAutonomy(story: StoryState, cast: Character[], spots: number, now = Date.now()): { story: StoryState; moves: GiftMove[] } {
  let s = story;
  const moves: GiftMove[] = [];
  const present = cast.map((c) => c.id);
  for (const c of cast) {
    const mine = ownedBy(s, c.id).filter((g) => s.turn - lastMoveTurn(g) >= MOVE_COOLDOWN);
    if (!mine.length) continue;
    const bond = bondWithPlayer(s, c.id);
    const p = personalityOf(c);
    const reserved = p.reserved >= 0.65 || p.hides > 0;
    const pick = (): { g: GiftInstance; to: Exclude<GiftDisplay, "refused">; why: GiftMoveReason } | null => {
      if (bond.affection <= -20) {
        const g = mine.find((x) => x.display === "displayed");
        if (g) return { g, to: "stored", why: "cooled" };
      }
      if (bond.trust <= -20) {
        const g = mine.find((x) => x.display === "private");
        if (g) return { g, to: "hidden", why: "guarded" };
      }
      if (bond.trust >= 40) {
        const g = mine.find((x) => x.display === "hidden");
        if (g) return { g, to: "private", why: "opened_up" };
      }
      if (bond.affection >= 40 && !reserved && freeSpotCount(s, spots) > 0) {
        const g = mine.find((x) => x.display === "carried" || x.display === "private");
        if (g) return { g, to: "displayed", why: "proud" };
      }
      if (bond.affection >= 50) {
        const g = mine.find((x) => x.display === "stored" && x.importance >= 2);
        if (g && ownedBy(s, c.id).filter((x) => x.display === "carried").length < CARRY_MAX) return { g, to: "carried", why: "treasured" };
      }
      return null;
    };
    const m = pick();
    if (m) {
      s = moveGift(s, m.g.id, m.to, m.why, present, now);
      moves.push({ id: m.g.id, owner: c.id, from: m.g.display, to: m.to, why: m.why });
    }
  }
  // Carried gifts are noticed by people who talk with the owner.
  for (const g of giftsOf(s)) {
    if (g.display !== "carried") continue;
    const talkers = Object.entries(s.talk ?? {})
      .filter(([k, lines]) => k.split("|").includes(g.owner) && lines.some((l) => l.turn >= g.receivedTurn))
      .flatMap(([k]) => k.split("|"))
      .filter((id) => id !== g.owner && !g.knownBy.includes(id));
    if (talkers.length) s = { ...s, gifts: { ...s.gifts, [g.id]: { ...g, knownBy: [...new Set([...g.knownBy, ...talkers])] } } };
  }
  return { story: s, moves };
}

// ---------------------------------------------------------------- conversations

export type GiftBrief = { name: string; description: string; where: GiftDisplay; owner: "listener" | "speaker"; speakerKnows: boolean; interpretation: string };

const GIFT_WORDS = /gift|present|keepsake|礼物|送|收到/i;

/**
 * Gifts worth telling the AI about in a conversation, ONLY when relevant:
 * the message mentions gifts or a gift by name, or the gift is on display
 * where the speaker has seen it. The listener's private / hidden gifts are
 * sent with speakerKnows=false so they're never revealed; the speaker's
 * gifts only if the listener knows about them and they aren't hidden.
 */
export function giftsForTalk(story: StoryState, listenerId: string, speakerId: string, message: string): GiftBrief[] {
  const asked = GIFT_WORDS.test(message);
  const named = (g: GiftInstance) => g.name.trim().length > 1 && message.toLowerCase().includes(g.name.trim().toLowerCase());
  const out: GiftBrief[] = [];
  for (const g of giftsOf(story)) {
    if (g.owner === listenerId) {
      const speakerKnows = g.knownBy.includes(speakerId);
      if (asked || named(g) || (g.display === "displayed" && speakerKnows)) out.push({ name: g.name, description: g.description, where: g.display, owner: "listener", speakerKnows, interpretation: g.interpretation });
    } else if (g.owner === speakerId && g.knownBy.includes(listenerId) && g.display !== "hidden" && g.display !== "private" && (asked || named(g))) {
      out.push({ name: g.name, description: g.description, where: g.display, owner: "speaker", speakerKnows: true, interpretation: "" });
    }
  }
  return out.slice(0, 3);
}
