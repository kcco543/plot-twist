/**
 * LIVE photo-reaction checks against the real model. Costs a few cents; skipped unless you ask:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... RUN_LIVE_AI=1 npx vitest run tests/live/photo.live.test.ts
 *
 * Test photos: put your own in tests/live/photos/ (animal.jpg, landscape.jpg,
 * object.jpg), or leave the folder empty and public-domain samples are
 * downloaded from Wikimedia Commons on the first run. "Unclear" is made by
 * shrinking and blurring the animal photo. Every reaction goes through
 * /api/ai/photo (same prompt, checks and retry as the game) and is written
 * to tests/live/photo-last-run.md so you can read how each character reacted.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as photoRoute } from "@/app/api/ai/photo/route";
import { resetTalkLimits } from "@/lib/ai/server/limits";
import { sampleCharacter } from "@/lib/mind/scenarios";
import { applyPhotoReaction, validatePhotoReply } from "@/lib/photo/apply";
import { photoProblem } from "@/lib/photo/checks";
import type { PhotoResponse } from "@/lib/photo/contract";
import { buildPhotoRequest } from "@/lib/photo/request";
import { emptyStory } from "@/lib/story/engine";
import { similarity } from "@/lib/story/similarity";
import type { Character, StoryState } from "@/lib/types";

const LIVE = process.env.RUN_LIVE_AI === "1" && !!process.env.ANTHROPIC_API_KEY;
const DIR = path.join(__dirname, "photos");
const OUT = path.join(__dirname, "photo-last-run.md");
const log = (s: string) => appendFileSync(OUT, s + "\n");

const SAMPLES: Record<string, string> = {
  animal: "https://commons.wikimedia.org/wiki/Special:FilePath/Cat03.jpg?width=1024",
  landscape: "https://commons.wikimedia.org/wiki/Special:FilePath/Hopetoun_falls.jpg?width=1024",
  object: "https://commons.wikimedia.org/wiki/Special:FilePath/Red_Apple.jpg?width=1024",
};

type Img = { data: string; width: number; height: number };
const photos: Record<string, Img> = {};

/** Re-encode like the game does (JPEG, max 1280 px, no metadata). */
async function load(buf: Buffer, blur = false): Promise<Img> {
  const sharp = (await import("sharp")).default;
  let p = sharp(buf).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true });
  if (blur) p = sharp(await sharp(buf).resize(20).toBuffer()).resize(640).blur(6);
  const { data, info } = await p.jpeg({ quality: 86 }).toBuffer({ resolveWithObject: true });
  return { data: data.toString("base64"), width: info.width, height: info.height };
}

const fresh = (): StoryState => ({ ...emptyStory(), turn: 10, relations: {}, decisions: [] });

async function show(story: StoryState, c: Character, img: Img, caption: string, locale: "en" | "zh-CN", title: string) {
  resetTalkLimits();
  const req = buildPhotoRequest({ story, character: c, locale, world: "western-fantasy", place: "street", placeDescription: "", caption, image: img });
  const res = await photoRoute(new Request("http://x/api/ai/photo", { method: "POST", body: JSON.stringify(req), headers: { "Content-Type": "application/json" } }));
  const data = (await res.json()) as PhotoResponse & { error?: string };
  expect(res.status, data.error).toBe(200);
  expect(data.source).toBe("ai");
  expect(photoProblem(data.reply, req)).toBeNull();
  const v = validatePhotoReply(data.reply, c, story);
  const r = data.reply;
  log(
    `### ${title}\n**${c.name}** (${r.reactionType}, ${v.emotion} ${v.level}, move ${v.move}): ${v.dialogue}${v.question ? `\n> ${v.question}` : ""}\n_saw: ${r.observation.description} [${r.observation.subjects.join(", ")}] · clarity ${r.observation.clarity} · people ${r.observation.containsPeople}_\n_memory${v.memory.suggested ? " (suggested)" : ""}: ${v.memory.note} · why: ${v.memory.significance || "-"} · importance ${v.memory.importance} · bond ${JSON.stringify(v.bond)} · attempts ${data.attempts}${v.adjustments.length ? ` · engine: ${v.adjustments.join(", ")}` : ""}_\n`,
  );
  return { v, reply: r, story: applyPhotoReaction(story, v, c) };
}

describe.skipIf(!LIVE)("live AI photo reactions", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    writeFileSync(OUT, `# Live AI photo run\n\n${new Date().toISOString()}\n\n`);
    mkdirSync(DIR, { recursive: true });
    for (const [k, url] of Object.entries(SAMPLES)) {
      const file = path.join(DIR, `${k}.jpg`);
      if (!existsSync(file)) {
        const res = await fetch(url, { headers: { "User-Agent": "plot-twist-live-test/1.0" } });
        if (!res.ok) throw new Error(`Could not download the ${k} sample (${res.status}). Put your own ${k}.jpg in tests/live/photos/.`);
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      photos[k] = await load(readFileSync(file));
    }
    photos.unclear = await load(readFileSync(path.join(DIR, "animal.jpg")), true);
  });

  it("an animal photo: talks about the animal, no invented details", async () => {
    const { reply } = await show(fresh(), sampleCharacter("mira", "en"), photos.animal, "", "en", "Animal (Mira)");
    expect(reply.observation.description.toLowerCase()).toMatch(/cat|kitten|animal/);
  });

  it("a landscape and a household object", async () => {
    const l = await show(fresh(), sampleCharacter("tobi", "en"), photos.landscape, "Went hiking last weekend!", "en", "Landscape (Tobi)");
    expect(l.reply.observation.description.toLowerCase()).toMatch(/water|fall|forest|tree|stream|river|moss|fern/);
    const o = await show(fresh(), sampleCharacter("wren", "en"), photos.object, "", "en", "Household object (Wren)");
    expect(o.reply.observation.description.toLowerCase()).toMatch(/apple|fruit/);
  });

  it("an unclear photo: the character is unsure or asks", async () => {
    const { reply } = await show(fresh(), sampleCharacter("mira", "en"), photos.unclear, "", "en", "Unclear photo (Mira)");
    expect(reply.observation.clarity).not.toBe("clear");
  });

  it("the same photo, three personalities: three different reactions", async () => {
    const lines: string[] = [];
    for (const id of ["mira", "wren", "tobi"] as const) lines.push((await show(fresh(), sampleCharacter(id, "en"), photos.animal, "My cat Biscuit", "en", `Same photo, ${id}`)).v.dialogue);
    expect(similarity(lines[0], lines[1])).toBeLessThan(0.6);
    expect(similarity(lines[1], lines[2])).toBeLessThan(0.6);
  });

  it("the same photo, two relationships: different tone", async () => {
    const m = sampleCharacter("mira", "en");
    const close: StoryState = { ...fresh(), player: { [m.id]: { trust: 70, affection: 75, familiarity: 60, photos: 8, recent: [] } } };
    const wary: StoryState = { ...fresh(), player: { [m.id]: { trust: -50, affection: -40, familiarity: 20, photos: 1, recent: [] } } };
    const a = await show(close, m, photos.landscape, "", "en", "Close friend (Mira)");
    const b = await show(wary, m, photos.landscape, "", "en", "Wary of the visitor (Mira)");
    expect(a.v.dialogue).not.toEqual(b.v.dialogue);
  });

  it("Chinese: answers in Chinese, names as written", async () => {
    const { v, reply } = await show(fresh(), sampleCharacter("mira", "zh-CN"), photos.animal, "这是我家的猫", "zh-CN", "中文 (米拉)");
    expect(/[一-鿿]/.test(v.dialogue)).toBe(true);
    expect(/[一-鿿]/.test(reply.observation.description)).toBe(true);
  });

  it("two photos in a row: the second reaction doesn't repeat the first", async () => {
    const m = sampleCharacter("tobi", "en");
    const first = await show(fresh(), m, photos.object, "", "en", "Repeat check 1 (Tobi)");
    const second = await show(first.story, m, photos.animal, "", "en", "Repeat check 2 (Tobi)");
    expect(similarity(first.v.dialogue, second.v.dialogue)).toBeLessThan(0.55);
  });
});
