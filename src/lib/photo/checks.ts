/**
 * FIRST-PASS CHECKS on a photo reaction (run by the server route).
 * --------------------------------------------------------------------------
 * sanitizePhotoReply() tidies the text and clamps every number into range.
 * photoProblem()       finds replies that break the rules (out of character,
 *                      wrong language, the same words as a recent reaction,
 *                      the model's own self-check failing). Such a reply is
 *                      retried once with the problem explained, then
 *                      rejected. It is never shown.
 * checkImage()         the uploaded bytes really are a small JPEG/PNG/WebP.
 *
 * The game engine validates the result again (apply.ts) before anything in
 * the game changes.
 */
import { isRepeat } from "../story/similarity";
import { cleanDialogue, cutText, inLanguage, outOfCharacter } from "../talk/ai/checks";
import {
  PHOTO_AI_MAX_BYTES,
  PHOTO_DESCRIPTION_MAX,
  PHOTO_DIALOGUE_MAX,
  PHOTO_QUESTION_MAX,
  PHOTO_SIGNIFICANCE_MAX,
  PHOTO_SUMMARY_MAX,
  type PhotoAiType,
  type PhotoReply,
  type PhotoRequest,
} from "./contract";

const clamp = (v: number, lo: number, hi: number, d = 0) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function sanitizePhotoReply(r: PhotoReply, req: Pick<PhotoRequest, "character">): PhotoReply {
  const name = req.character.fields.name ?? "";
  const tags: string[] = [];
  for (const t of r.observation.subjects) {
    const tag = cutText(oneLine(t), 24);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 5) break;
  }
  return {
    ...r,
    observation: { ...r.observation, description: cutText(oneLine(r.observation.description), PHOTO_DESCRIPTION_MAX), subjects: tags },
    dialogue: cutText(cleanDialogue(r.dialogue, name), PHOTO_DIALOGUE_MAX),
    intensity: clamp(r.intensity, 0, 1, 0.4),
    relationshipChanges: { trust: Math.round(clamp(r.relationshipChanges.trust, -5, 5)), affection: Math.round(clamp(r.relationshipChanges.affection, -5, 5)) },
    memory: {
      suggestSave: !!r.memory.suggestSave,
      summary: cutText(oneLine(r.memory.summary), PHOTO_SUMMARY_MAX),
      significance: cutText(oneLine(r.memory.significance), PHOTO_SIGNIFICANCE_MAX),
      importance: Math.round(clamp(r.memory.importance, 1, 3, 1)),
    },
    followUpQuestion: cutText(cleanDialogue(r.followUpQuestion, name), PHOTO_QUESTION_MAX),
  };
}

export type PhotoProblem = "empty" | "out_of_character" | "self_check" | "wrong_language" | "repeat";

/** The first rule the reply breaks, or null. Run on a sanitized reply. */
export function photoProblem(r: PhotoReply, req: PhotoRequest): PhotoProblem | null {
  const names = [req.character.fields.name ?? ""];
  if (!r.dialogue.trim()) return "empty";
  if ([r.dialogue, r.followUpQuestion, r.memory.summary].some(outOfCharacter)) return "out_of_character";
  if (!r.staysInCharacter) return "self_check";
  for (const s of [r.dialogue, r.followUpQuestion, r.observation.description, r.memory.summary]) if (s && !inLanguage(s, req.locale, names)) return "wrong_language";
  if (isRepeat(r.dialogue, req.recentReactions.map((x) => x.dialogue), 0.55)) return "repeat";
  return null;
}

/** Feedback for the one retry. */
export const PHOTO_PROBLEM_FEEDBACK: Record<PhotoProblem, string> = {
  empty: "The dialogue was empty. The character must say something about the photo (even a few words).",
  out_of_character: "The reply broke character (it sounded like an AI assistant describing an image). Answer only as the character, inside the game world.",
  self_check: "You marked the reply as not in character. Write one that respects the character's canon, boundaries and voice, and the photo rules.",
  wrong_language: "Some text was not in the required language. Write the dialogue, question, description and memory in the game language given.",
  repeat: "The dialogue repeated one of the character's recent photo reactions. React differently, in fresh words.",
};

// ---------------------------------------------------------------- image bytes

export type ImageProblem = "type" | "size" | "empty";

/** Which image format the bytes are, by their first bytes (never trusting the declared type alone). */
export function sniffImage(b: Uint8Array): PhotoAiType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Decode and check the base64 image: real bytes, declared type matches, not too big. */
export function checkImage(data: string, declared: PhotoAiType): { ok: true; bytes: number } | { ok: false; problem: ImageProblem } {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, problem: "type" };
  const bytes = Uint8Array.from(Buffer.from(data, "base64"));
  if (!bytes.length) return { ok: false, problem: "empty" };
  if (bytes.length > PHOTO_AI_MAX_BYTES) return { ok: false, problem: "size" };
  if (sniffImage(bytes) !== declared) return { ok: false, problem: "type" };
  return { ok: true, bytes: bytes.length };
}
