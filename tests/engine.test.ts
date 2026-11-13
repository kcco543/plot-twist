import { describe, expect, it } from "vitest";
import { getEvent } from "@/lib/story/events";
import { emptyStory, plan, type Action } from "@/lib/story/engine";
import { beatToLines } from "@/lib/story/localWriter";
import { renderLine } from "@/lib/scenes";
import { isRepeat, similarity } from "@/lib/story/similarity";
import type { Character, StoryState } from "@/lib/types";
import { juniper, mei, rook, seeded } from "./helpers";

function run(cast: Character[], actions: Action[], seed = 1) {
  const rng = seeded(seed);
  let story: StoryState = emptyStory();
  const beats = [];
  for (let i = 0; i < actions.length; i++) {
    const res = plan({ story, cast, actorId: cast[i % cast.length].id, action: actions[i], world: "otherworld", place: "street", frequency: "normal", rng });
    story = res.story;
    beats.push(res.beat);
  }
  return { story, beats };
}

describe("story engine", () => {
  const cast = [juniper(), rook(), mei()];

  it("never repeats the same event twice in a row and respects cooldowns", () => {
    const { beats } = run(cast, Array(120).fill("twist"));
    const events = beats.filter((b) => b.kind === "event");
    expect(events.length).toBeGreaterThan(80);
    for (let i = 1; i < events.length; i++) expect(events[i].type).not.toBe(events[i - 1].type);
    for (const b of events) {
      const def = getEvent(b.type)!;
      const earlier = events.filter((e) => e.type === b.type && e.turn < b.turn).at(-1);
      if (earlier) expect(b.turn - earlier.turn).toBeGreaterThanOrEqual(def.cooldown);
    }
  });

  it("uses a wide range of events, reactions and dialogue approaches", () => {
    const { beats } = run(cast, Array(150).fill("twist"), 7);
    expect(new Set(beats.map((b) => b.type)).size).toBeGreaterThanOrEqual(12);
    expect(new Set(beats.map((b) => b.reaction)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(beats.map((b) => b.approach)).size).toBeGreaterThanOrEqual(6);
  });

  it("gives the same personality different reactions to the same kind of situation", () => {
    const { beats } = run([juniper(), rook()], Array(200).fill("twist"), 3);
    const juniperTeased = beats.filter((b) => b.type === "tease" && b.actorId === "c-juniper").map((b) => b.reaction);
    expect(new Set(juniperTeased).size).toBeGreaterThan(1);
  });

  it("only allows reactions that respect boundaries (temptation never 'breaks' a rule)", () => {
    const { beats } = run(cast, Array(200).fill("twist"), 11);
    for (const b of beats.filter((x) => x.type === "temptation")) expect(getEvent("temptation")!.reactions).toContain(b.reaction);
  });

  it("never changes what the player wrote, locked or not", () => {
    const before = JSON.stringify(cast);
    run(cast, [...Array(50).fill("twist"), ...Array(30).fill("talk"), ...Array(20).fill("wait")]);
    expect(JSON.stringify(cast)).toBe(before);
  });

  it("keeps bonds within range and memories capped", () => {
    const { story } = run(cast, Array(300).fill("twist"), 5);
    for (const b of Object.values(story.bonds)) {
      expect(Math.abs(b.affinity)).toBeLessThanOrEqual(100);
      expect(Math.abs(b.trust)).toBeLessThanOrEqual(100);
    }
    for (const s of Object.values(story.characters)) expect(s.memories.length).toBeLessThanOrEqual(24);
    expect(story.events.length).toBeLessThanOrEqual(60);
  });

  it("remembers significant events and can recall them later", () => {
    const { story, beats } = run(cast, Array(80).fill("twist"), 9);
    expect(Object.values(story.characters).some((s) => s.memories.length > 0)).toBe(true);
    const echo = beats.find((b) => b.type === "memoryEcho");
    expect(echo?.recalled).toBeTruthy();
  });

  it("rotates talk topics instead of repeating one", () => {
    const { beats } = run([juniper()], Array(8).fill("talk"));
    for (let i = 1; i < beats.length; i++) expect(beats[i].topic === beats[i - 1].topic && beats[i].approach === beats[i - 1].approach).toBe(false);
    expect(new Set(beats.map((b) => b.topic)).size).toBeGreaterThanOrEqual(4);
  });

  it("event frequency: 'calm' turns fewer waits into events than 'chaotic'", () => {
    const count = (frequency: "calm" | "chaotic") => {
      const rng = seeded(2);
      let story = emptyStory();
      let events = 0;
      for (let i = 0; i < 200; i++) {
        const r = plan({ story, cast, actorId: cast[i % 3].id, action: "wait", world: "modern", place: "interior", frequency, rng });
        story = r.story;
        if (r.beat.kind === "event") events++;
      }
      return events;
    };
    expect(count("calm")).toBeLessThan(count("chaotic"));
  });
});

describe("built-in writer", () => {
  it("renders every beat in English and Chinese with no missing placeholders or keys", () => {
    const cast = [juniper(), rook(), mei()];
    const { beats } = run(cast, [...Array(120).fill("twist"), ...Array(20).fill("talk"), ...Array(10).fill("observe"), ...Array(10).fill("wait")], 4);
    const seen = new Set<string>();
    for (const b of beats) {
      for (const line of beatToLines(b, cast, "street", "otherworld")) {
        for (const locale of ["en", "zh-CN"] as const) {
          const { text, speaker } = renderLine(line, locale);
          expect(text, `${b.type} ${locale}`).not.toMatch(/\{\w+\}|story\.|memories\.|moods\./);
          expect(text.length).toBeGreaterThan(0);
          expect(speaker.length).toBeGreaterThan(0);
          seen.add(text);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(150);
  });

  it("quotes the player's own words unchanged", () => {
    const cast = [juniper()];
    const { beats } = run(cast, ["talk"]);
    const text = renderLine(beatToLines(beats[0], cast, "street", "otherworld")[0], "zh-CN").text;
    expect([cast[0].goals, cast[0].fears, cast[0].relationships, cast[0].values].some((v) => text.includes(v.replace(/\.$/, "")))).toBe(true);
  });
});

describe("repetition check", () => {
  it("flags near-identical lines in either language", () => {
    expect(similarity("I'm not letting that slide, Rook.", "I'm not letting that slide, Rook!")).toBeGreaterThan(0.8);
    expect(isRepeat("这事我不会就这么算了。", ["这事我不会就这么算了！"])).toBe(true);
    expect(isRepeat("A completely new line about cake.", ["I'm not letting that slide."])).toBe(false);
  });
});
