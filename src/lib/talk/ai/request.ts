/**
 * Building the request for one AI reply, and sending it.
 * --------------------------------------------------------------------------
 * buildTalkRequest() gathers only what this reply needs, never the whole
 * save: both characters' profiles (as the player wrote them), how each sees
 * the other, the listener's current emotion and feelings, the last
 * HISTORY_MAX lines between them, up to MEMORY_MAX memories chosen for
 * relevance (open threads first, then the strongest memories with this
 * person, then a couple of big ones with others), the last relationship
 * shifts, a few recent story-log lines and the behavior engine's hint.
 */
import { briefFor } from "../../ai/client";
import { emotionOf } from "../../emotion/emotions";
import { behaviorBrief, type Decision } from "../../mind";
import { feelingsOf, ranked } from "../../mind/feelings";
import { memoryKindOf } from "../../mind/memory";
import { relationOf, relKey } from "../../mind/relations";
import { PLAYER_ID, type Character, type EnvironmentTypeId, type Memory, type StoryState, type WorldId } from "../../types";
import { giftsForTalk } from "../../gifts/apply";
import type { RequestDecision } from "../../relationships/boundaries";
import { relationshipSummary } from "../../relationships/summary";
import { pairKey } from "./apply";
import { HISTORY_MAX, MEMORY_MAX, MESSAGE_MAX, TalkReplySchema, type TalkMemory, type TalkRequest, type TalkResponse } from "./contract";

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

export type BuildInput = {
  story: StoryState;
  speaker: Character;
  listener: Character;
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  placeDescription: string;
  message: string;
  kind: TalkRequest["message"]["kind"];
  topic: string | null;
  decision: Decision | null;
  recentEvents: string[];
  usedTopics: string[];
  /** The game's decision about what the listener is willing to do (boundaries.ts). */
  request?: RequestDecision | null;
};

function decisionBrief(d: RequestDecision): NonNullable<TalkRequest["decision"]> {
  const b = d.analysis.boundary;
  return {
    kind: d.analysis.kind,
    tier: d.analysis.tier,
    intention: d.intention,
    allowed: d.allowed,
    disclosure: d.disclosure,
    mustNotReveal: d.mustNotReveal.slice(0, 3).map((m) => cut(m, 240)),
    askedBefore: Math.min(10000, d.askedBefore),
    refusedBefore: Math.min(10000, d.refusedBefore),
    valueConflicts: d.analysis.valueConflicts.slice(0, 6),
    reasoned: d.analysis.reasoned,
    endConversation: d.endConversation,
    boundary: b ? { strength: b.strength, kind: b.kind, text: cut(b.text, 240) } : null,
  };
}

function toTalkMemory(m: Memory, story: StoryState, holder: "listener" | "speaker"): TalkMemory {
  return {
    // Photo memories: the character's own summary already says what the photo showed.
    summary: cut(m.note ?? m.photo?.description ?? "", 200),
    kind: cut(m.photo ? "photo from the visitor" : (memoryKindOf(m) ?? m.eventType), 30),
    withName: cut(m.withId === PLAYER_ID ? "the visitor" : m.withName, 80),
    importance: Math.max(1, Math.min(3, Math.round(m.importance))),
    thread: m.thread ?? "none",
    resolved: !!m.resolved,
    turnsAgo: Math.max(0, story.turn - m.turn),
    holder,
  };
}

/** Memories worth sending: open threads with this person, strongest with them, then big ones with others. */
export function pickMemories(story: StoryState, listener: Character, speaker: Character): TalkMemory[] {
  const mine = story.characters[listener.id]?.memories ?? [];
  const theirs = story.characters[speaker.id]?.memories ?? [];
  const score = (m: Memory) => m.importance * 10 - Math.max(0, story.turn - m.turn) * 0.2 + (m.note ? 3 : 0);
  const picked: Memory[] = [];
  const add = (list: Memory[], n: number) => {
    for (const m of list) {
      if (picked.length >= MEMORY_MAX || n <= 0) return;
      if (picked.includes(m)) continue;
      picked.push(m);
      n--;
    }
  };
  const withThem = mine.filter((m) => m.withId === speaker.id);
  add(withThem.filter((m) => m.thread && !m.resolved), 3);
  add([...withThem].sort((a, b) => score(b) - score(a)), 5);
  add(mine.filter((m) => m.withId !== speaker.id && m.importance >= 2).sort((a, b) => score(b) - score(a)), 2);
  const out = picked.map((m) => toTalkMemory(m, story, "listener"));
  const theirsWithListener = theirs.filter((m) => m.withId === listener.id).sort((a, b) => score(b) - score(a)).slice(0, Math.max(0, MEMORY_MAX - out.length)).slice(0, 2);
  return [...out, ...theirsWithListener.map((m) => toTalkMemory(m, story, "speaker"))];
}

const fmtDelta = (d: Record<string, number | undefined>) =>
  Object.entries(d)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`)
    .join(", ");

export function buildTalkRequest(i: BuildInput): TalkRequest {
  const { story, speaker, listener } = i;
  const lv = relationOf(story, listener, speaker);
  const sv = relationOf(story, speaker, listener);
  const em = emotionOf(story.characters[listener.id]);
  const hist = (story.talk?.[pairKey(speaker.id, listener.id)] ?? [])
    .filter((l) => l.from === speaker.id || l.from === listener.id)
    .slice(-HISTORY_MAX)
    .map((l) => ({ who: (l.from === listener.id ? "listener" : "speaker") as "listener" | "speaker", text: cut(l.text, 360) }));
  const shifts = (story.relationLog?.[relKey(listener.id, speaker.id)] ?? []).slice(-4).map((r) => cut(`${Math.max(0, story.turn - r.turn)} turns ago: ${fmtDelta(r.delta)} (${r.why})`, 160));
  const b = i.decision ? behaviorBrief(i.decision) : null;
  return {
    locale: i.locale === "zh-CN" ? "zh-CN" : "en",
    world: i.world,
    place: i.place,
    placeDescription: cut(i.placeDescription, 600),
    speaker: briefFor(speaker),
    listener: briefFor(listener),
    listenerView: lv,
    speakerView: sv,
    listenerState: {
      emotion: em.emotion,
      level: em.level,
      feelings: ranked(feelingsOf(story.characters[listener.id]))
        .slice(0, 4)
        .map(([feeling, value]) => ({ feeling, value: Math.max(0, Math.min(100, value)) })),
    },
    message: { text: cut(i.message, MESSAGE_MAX * 2), kind: i.kind, topic: i.topic ? cut(i.topic, 40) : null },
    history: hist,
    memories: pickMemories(story, listener, speaker),
    relationHistory: shifts,
    recentEvents: i.recentEvents.slice(-6).map((e) => cut(e, 240)),
    engineHint: b
      ? {
          intent: cut(b.intent, 40),
          shows: b.shows ? cut(b.shows.emotion, 20) : null,
          hides: b.hiddenFeeling ? cut(b.hiddenFeeling, 20) : null,
          tone: b.style.tone,
          length: b.style.length,
          directness: b.style.directness,
          humor: b.style.humor,
          disclosure: b.style.disclosure,
        }
      : null,
    usedTopics: i.usedTopics.slice(-12).map((t) => cut(t, 160)),
    relationship: (() => {
      const r = relationshipSummary(story, listener, speaker);
      return {
        stages: r.stages,
        label: r.label,
        impressions: r.impressions.map((x) => ({ theme: x.theme, polarity: x.polarity, strength: x.strength })),
        conflicts: r.conflicts.map((c) => cut(c, 120)),
        promises: r.promises.map((c) => cut(c, 160)),
        milestones: r.milestones.map((c) => cut(c, 120)),
      };
    })(),
    ...(i.request ? { decision: decisionBrief(i.request) } : {}),
    gifts: giftsForTalk(story, listener.id, speaker.id, i.message).map((g) => ({ ...g, name: cut(g.name, 60), description: cut(g.description, 260), interpretation: cut(g.interpretation, 200) })),
  };
}

// ---------------------------------------------------------------- sending

export type TalkErrorCode = "not_configured" | "refused" | "invalid_output" | "rate_limited" | "auth" | "failed" | "offline" | "timeout" | "busy" | "limit" | "bad_request" | "too_large" | "cancelled";
export type TalkResult = { ok: true; data: TalkResponse } | { ok: false; code: TalkErrorCode };

/** Give up waiting after this long (the server's own calls stop sooner). */
export const CLIENT_TIMEOUT_MS = 50_000;

/** POST the request. Never throws; a failure is a result the game shows as a failure. */
export async function sendTalkRequest(req: TalkRequest, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<TalkResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), CLIENT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort("cancelled");
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetchImpl("/api/ai/talk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: (data?.error as TalkErrorCode) ?? "failed" };
    // Validate the shape again on arrival: only allowed emotions / movements / fields get through.
    const reply = TalkReplySchema.safeParse(data?.reply);
    if (!reply.success || (data.source !== "ai" && data.source !== "mock")) return { ok: false, code: "invalid_output" };
    return { ok: true, data: { reply: reply.data, source: data.source, model: String(data.model ?? ""), attempts: Number(data.attempts) || 1 } };
  } catch {
    if (ctrl.signal.aborted) return { ok: false, code: ctrl.signal.reason === "cancelled" ? "cancelled" : "timeout" };
    return { ok: false, code: "offline" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
