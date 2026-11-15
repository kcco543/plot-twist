/**
 * FIRST-PASS CHECKS on a gift reaction (server route): tidy and clamp, then
 * find replies that break the rules (out of character, wrong language, a
 * repeat of an earlier gift reaction, failed self-check). One retry, then
 * rejected. The game engine validates again (apply.ts).
 */
import { isRepeat } from "../story/similarity";
import { cleanDialogue, cutText, inLanguage, outOfCharacter } from "../talk/ai/checks";
import { sniffImage } from "../photo/checks";
import { GIFT_DIALOGUE_MAX, GIFT_IMAGE_MAX_BYTES, type GiftReactionReply, type GiftReactionRequest } from "./contract";

const clamp = (v: number, lo: number, hi: number, d = 0) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function sanitizeGiftReply(r: GiftReactionReply, req: Pick<GiftReactionRequest, "character">): GiftReactionReply {
  const name = req.character.fields.name ?? "";
  return {
    ...r,
    interpretation: cutText(oneLine(r.interpretation), 200),
    dialogue: cutText(cleanDialogue(r.dialogue, name), GIFT_DIALOGUE_MAX),
    intensity: clamp(r.intensity, 0, 1, 0.4),
    keepReason: cutText(oneLine(r.keepReason), 120),
    relationshipChanges: { trust: Math.round(clamp(r.relationshipChanges.trust, -5, 5)), affection: Math.round(clamp(r.relationshipChanges.affection, -5, 5)) },
    memory: { summary: cutText(oneLine(r.memory.summary), 200), significance: cutText(oneLine(r.memory.significance), 140), importance: Math.round(clamp(r.memory.importance, 1, 3, 1)) },
    followUpQuestion: cutText(cleanDialogue(r.followUpQuestion, name), 160),
  };
}

export type GiftProblem = "empty" | "out_of_character" | "self_check" | "wrong_language" | "repeat";

export function giftProblem(r: GiftReactionReply, req: GiftReactionRequest): GiftProblem | null {
  const names = [req.character.fields.name ?? "", req.gift.name];
  if (!r.dialogue.trim()) return "empty";
  if ([r.dialogue, r.followUpQuestion, r.memory.summary, r.interpretation].some(outOfCharacter)) return "out_of_character";
  if (!r.staysInCharacter) return "self_check";
  for (const s of [r.dialogue, r.followUpQuestion, r.interpretation, r.memory.summary]) if (s && !inLanguage(s, req.locale, names)) return "wrong_language";
  if (isRepeat(r.dialogue, req.earlierGifts.map((g) => g.interpretation), 0.6)) return "repeat";
  return null;
}

export const GIFT_PROBLEM_FEEDBACK: Record<GiftProblem, string> = {
  empty: "The dialogue was empty. The character must say something (even a few words).",
  out_of_character: "The reply broke character (it sounded like an AI assistant). Answer only as the character, inside the game world.",
  self_check: "You marked the reply as not in character. Write one that respects the character's canon, boundaries and voice.",
  wrong_language: "Some text was not in the required language. Write everything in the game language given (the gift's name may stay as written).",
  repeat: "The reaction repeated an earlier gift reaction. React freshly to this gift.",
};

/** The gift picture must really be a small PNG. */
export function checkGiftImage(data: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  const bytes = Uint8Array.from(Buffer.from(data, "base64"));
  return bytes.length > 0 && bytes.length <= GIFT_IMAGE_MAX_BYTES && sniffImage(bytes) === "image/png";
}
