/**
 * Building and sending one gift reaction request (browser side).
 */
import { briefFor } from "../ai/client";
import { emotionOf } from "../emotion/emotions";
import { feelingsOf, ranked } from "../mind/feelings";
import { bondWithPlayer } from "../photo/apply";
import { VISITOR } from "../photo/request";
import { PLAYER_ID, type Character, type EnvironmentTypeId, type Memory, type StoryState, type WorldId } from "../types";
import { giftsOf } from "./apply";
import { GiftReactionReplySchema, type GiftReactionRequest, type GiftReactionResponse } from "./contract";

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

export type GiftBuildInput = {
  story: StoryState;
  character: Character;
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  placeDescription: string;
  item: { id: string; name: string; description: string; image: string | null };
  freeDisplaySpots: number;
};

export function buildGiftRequest(i: GiftBuildInput): GiftReactionRequest {
  const { story, character, item } = i;
  const locale = i.locale === "zh-CN" ? "zh-CN" : "en";
  const em = emotionOf(story.characters[character.id]);
  const bond = bondWithPlayer(story, character.id);
  const score = (m: Memory) => m.importance * 10 - Math.max(0, story.turn - m.turn) * 0.2 + (m.withId === PLAYER_ID ? 6 : 0);
  const memories = (story.characters[character.id]?.memories ?? [])
    .filter((m) => m.note)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6)
    .map((m) => ({ summary: cut(m.note ?? "", 200), withName: cut(m.withId === PLAYER_ID ? VISITOR[locale] : m.withName, 80), importance: Math.max(1, Math.min(3, Math.round(m.importance))), turnsAgo: Math.max(0, story.turn - m.turn) }));
  const mine = giftsOf(story).filter((g) => g.recipient === character.id);
  const image = item.image?.startsWith("data:image/png;base64,") ? item.image.slice("data:image/png;base64,".length) : null;
  return {
    locale,
    world: i.world,
    place: i.place,
    placeDescription: cut(i.placeDescription, 600),
    character: briefFor(character),
    state: {
      emotion: em.emotion,
      level: em.level,
      feelings: ranked(feelingsOf(story.characters[character.id]))
        .slice(0, 4)
        .map(([feeling, value]) => ({ feeling, value: Math.max(0, Math.min(100, value)) })),
    },
    player: { trust: bond.trust, affection: bond.affection, familiarity: bond.familiarity, photosShared: bond.photos, giftsGiven: bond.gifts ?? 0 },
    memories,
    earlierGifts: mine.slice(-4).map((g) => ({ name: cut(g.name, 60), display: g.display, interpretation: cut(g.interpretation, 200) })),
    gift: { name: cut(item.name.trim(), 60), description: cut(item.description.trim(), 260), image, repeat: mine.some((g) => g.itemId === item.id) },
    freeDisplaySpots: Math.max(0, Math.min(10, i.freeDisplaySpots)),
  };
}

export type GiftErrorCode = "not_configured" | "unsupported" | "refused" | "invalid_output" | "rate_limited" | "auth" | "failed" | "offline" | "timeout" | "busy" | "limit" | "bad_request" | "bad_image" | "too_large" | "cancelled" | "billing";
export type GiftResult = { ok: true; data: GiftReactionResponse } | { ok: false; code: GiftErrorCode };
export const GIFT_RETRYABLE = new Set<GiftErrorCode>(["timeout", "offline", "failed", "rate_limited", "busy", "invalid_output", "refused", "limit"]);

export async function sendGiftRequest(req: GiftReactionRequest, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<GiftResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), 50_000);
  const onAbort = () => ctrl.abort("cancelled");
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetchImpl("/api/ai/gift-reaction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: (data?.error as GiftErrorCode) ?? "failed" };
    const reply = GiftReactionReplySchema.safeParse(data?.reply);
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
