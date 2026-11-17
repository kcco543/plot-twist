/**
 * Building the request for one photo reaction, and sending it. Browser side.
 * --------------------------------------------------------------------------
 * Called only after the player confirmed sending the photo. The request
 * carries the kept JPEG (already re-encoded: max 1280 px, no metadata) and
 * only the context this reaction needs: the character's profile as the
 * player wrote it, their emotion, how they feel about the player, a few
 * memories (photo moments with the player first) and their last reactions.
 */
import { briefFor } from "../ai/client";
import { emotionOf } from "../emotion/emotions";
import { feelingsOf, ranked } from "../mind/feelings";
import { PLAYER_ID, type Character, type EnvironmentTypeId, type Memory, type StoryState, type WorldId } from "../types";
import { bondWithPlayer } from "./apply";
import { PHOTO_AI_MAX_BYTES, PHOTO_REACTIONS, PhotoReplySchema, type PhotoReactionType, type PhotoRequest, type PhotoResponse } from "./contract";

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

export type PhotoBuildInput = {
  story: StoryState;
  character: Character;
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  placeDescription: string;
  caption: string;
  image: { data: string; width: number; height: number };
};

/** How the player is called inside the world, for the AI (memories "with the visitor"). */
export const VISITOR = { en: "the visitor", "zh-CN": "访客" } as const;

function pickPhotoMemories(story: StoryState, c: Character, locale: "en" | "zh-CN"): PhotoRequest["memories"] {
  const mine = (story.characters[c.id]?.memories ?? []).filter((m) => m.note);
  const score = (m: Memory) => m.importance * 10 - Math.max(0, story.turn - m.turn) * 0.2 + (m.withId === PLAYER_ID ? 6 : 0);
  return [...mine]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6)
    .map((m) => ({
      summary: cut(m.note ?? "", 200),
      withName: cut(m.withId === PLAYER_ID ? VISITOR[locale] : m.withName, 80),
      importance: Math.max(1, Math.min(3, Math.round(m.importance))),
      turnsAgo: Math.max(0, story.turn - m.turn),
    }));
}

export function buildPhotoRequest(i: PhotoBuildInput): PhotoRequest {
  const { story, character } = i;
  const locale = i.locale === "zh-CN" ? "zh-CN" : "en";
  const em = emotionOf(story.characters[character.id]);
  const bond = bondWithPlayer(story, character.id);
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
    player: { trust: bond.trust, affection: bond.affection, familiarity: bond.familiarity, photosShared: bond.photos },
    memories: pickPhotoMemories(story, character, locale),
    recentReactions: bond.recent
      .filter((r) => (PHOTO_REACTIONS as readonly string[]).includes(r.type))
      .slice(-4)
      .map((r) => ({ type: r.type as PhotoReactionType, dialogue: cut(r.dialogue, 320) })),
    caption: cut(i.caption.trim(), 200),
    image: { mediaType: "image/jpeg", data: i.image.data, width: i.image.width, height: i.image.height },
  };
}

/** The photo as base64 (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------- sending

export type PhotoErrorCode =
  | "not_configured"
  | "unsupported"
  | "refused"
  | "invalid_output"
  | "rate_limited"
  | "auth"
  | "failed"
  | "offline"
  | "timeout"
  | "busy"
  | "limit"
  | "bad_request"
  | "bad_image"
  | "too_large"
  | "cancelled"
  | "billing"
  | "ai_off"
  | "budget";
export type PhotoResult = { ok: true; data: PhotoResponse } | { ok: false; code: PhotoErrorCode };

export const PHOTO_CLIENT_TIMEOUT_MS = 60_000;
/** Failures worth a "Try again" button. */
export const PHOTO_RETRYABLE = new Set<PhotoErrorCode>(["timeout", "offline", "failed", "rate_limited", "busy", "invalid_output", "refused", "limit"]);

/** POST the request. Never throws; a failure is a result the game shows as a failure. */
export async function sendPhotoRequest(req: PhotoRequest, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<PhotoResult> {
  if (req.image.data.length > Math.ceil((PHOTO_AI_MAX_BYTES * 4) / 3)) return { ok: false, code: "too_large" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), PHOTO_CLIENT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort("cancelled");
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetchImpl("/api/ai/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: (data?.error as PhotoErrorCode) ?? "failed" };
    const reply = PhotoReplySchema.safeParse(data?.reply);
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
