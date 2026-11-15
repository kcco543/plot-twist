import { describe, expect, it } from "vitest";
import { delayBefore, pauseAfter, splitGraphemes, typingDuration } from "@/lib/dialogue/typewriter";
import { BUBBLE, bubbleMaxWidth, placeBubble } from "@/lib/dialogue/bubble";
import { TEXT_SPEED_MS } from "@/lib/settingsStore";

/** Every intermediate frame the typewriter would show. */
const frames = (text: string) => {
  const g = splitGraphemes(text);
  return g.map((_, i) => g.slice(0, i + 1).join(""));
};
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("typewriter graphemes", () => {
  it("reveals short English one letter at a time", () => {
    expect(splitGraphemes("Hi, Rook!")).toEqual(["H", "i", ",", " ", "R", "o", "o", "k", "!"]);
  });

  it("reveals Chinese one character at a time", () => {
    expect(splitGraphemes("你好，世界。")).toEqual(["你", "好", "，", "世", "界", "。"]);
  });

  it("never splits emoji, flags, skin tones or accents", () => {
    const text = "Mei 👩‍🚀 waves 👋🏽 from 🇨🇳 — café! 😊";
    const g = splitGraphemes(text);
    expect(g).toContain("👩‍🚀");
    expect(g).toContain("👋🏽");
    expect(g).toContain("🇨🇳");
    expect(g.join("")).toBe(text);
    for (const f of frames(text)) expect(lone.test(f)).toBe(false);
    // Decomposed é (e + combining accent) stays together.
    expect(splitGraphemes("café")).toEqual(["c", "a", "f", "é"]);
  });

  it("handles mixed Chinese and English", () => {
    const text = "Juniper 说：“OK，我们走吧！” Let's go.";
    const g = splitGraphemes(text);
    expect(g.join("")).toBe(text);
    expect(g.slice(0, 10)).toEqual(["J", "u", "n", "i", "p", "e", "r", " ", "说", "："]);
  });

  it("rebuilds long lines exactly, frame by frame", () => {
    const en = "The lantern flickered as Rook leaned closer, whispering that the map had been wrong all along — and that someone in this very room had drawn it on purpose.";
    const zh = "灯笼忽明忽暗。Rook 凑近低声说，这张地图从一开始就是错的——而且画图的人，此刻就在这个房间里，故意画错了它。";
    for (const text of [en, zh]) {
      const f = frames(text);
      expect(f.at(-1)).toBe(text);
      for (let i = 1; i < f.length; i++) expect(f[i].startsWith(f[i - 1])).toBe(true);
    }
  });

  it("returns nothing for empty text", () => {
    expect(splitGraphemes("")).toEqual([]);
  });
});

describe("typewriter pacing", () => {
  it("uses the requested speeds", () => {
    expect(TEXT_SPEED_MS).toEqual({ slow: 80, normal: 40, fast: 15, instant: 0 });
  });

  it("is instant at 0 ms", () => {
    expect(typingDuration("Hello there. 你好。", 0)).toBe(0);
    expect(delayBefore(splitGraphemes("abc"), 2, 0)).toBe(0);
  });

  it("starts immediately and waits one step per character", () => {
    const g = splitGraphemes("abc");
    expect(delayBefore(g, 0, 40)).toBe(0);
    expect(delayBefore(g, 1, 40)).toBe(40);
    expect(typingDuration("abcd", 15)).toBe(45);
  });

  it("rests a little after punctuation, once per run", () => {
    expect(pauseAfter(".", " ")).toBeGreaterThan(1);
    expect(pauseAfter("。", "我")).toBeGreaterThan(1);
    expect(pauseAfter("，", "我")).toBeGreaterThan(1);
    expect(pauseAfter("?", "!")).toBe(1); // wait for the whole "?!"
    expect(pauseAfter("。", "」")).toBe(1); // ...and the closing quote
    expect(pauseAfter(".", "1")).toBe(1); // 3.14 is not a sentence end
    expect(pauseAfter("a", "b")).toBe(1);
  });

  it("slower settings take longer", () => {
    const line = "Short line, then another!";
    expect(typingDuration(line, TEXT_SPEED_MS.slow)).toBeGreaterThan(typingDuration(line, TEXT_SPEED_MS.normal));
    expect(typingDuration(line, TEXT_SPEED_MS.normal)).toBeGreaterThan(typingDuration(line, TEXT_SPEED_MS.fast));
  });
});

describe("speech bubble placement", () => {
  const stage = { stageW: 640, stageH: 384 };

  it("sits centred above the speaker", () => {
    const p = placeBubble({ ...stage, anchorX: 320, anchorY: 288, width: 200, height: 60 });
    expect(p.left).toBe(220);
    expect(p.top + 60 + BUBBLE.tail + BUBBLE.gap).toBe(288);
    expect(p.tailX).toBe(100);
  });

  it("stays inside the stage near the edges, tail still points at the speaker", () => {
    const left = placeBubble({ ...stage, anchorX: 8, anchorY: 288, width: 200, height: 60 });
    expect(left.left).toBe(BUBBLE.margin);
    expect(left.tailX).toBe(BUBBLE.tailInset);
    const right = placeBubble({ ...stage, anchorX: 630, anchorY: 288, width: 200, height: 60 });
    expect(right.left + 200).toBe(640 - BUBBLE.margin);
    expect(right.tailX).toBe(200 - BUBBLE.tailInset);
  });

  it("follows the speaker when they (or the camera) move", () => {
    const a = placeBubble({ ...stage, anchorX: 300, anchorY: 288, width: 160, height: 60 });
    const b = placeBubble({ ...stage, anchorX: 340, anchorY: 250, width: 160, height: 60 });
    expect(b.left - a.left).toBe(40);
    expect(b.top - a.top).toBe(-38);
  });

  it("never leaves the top of a tiny stage", () => {
    const p = placeBubble({ stageW: 300, stageH: 120, anchorX: 150, anchorY: 60, width: 200, height: 70 });
    expect(p.top).toBeGreaterThanOrEqual(BUBBLE.margin);
  });

  it("caps width on phones and desktops", () => {
    expect(bubbleMaxWidth(340)).toBeLessThanOrEqual(340 - 2 * BUBBLE.margin);
    expect(bubbleMaxWidth(1200)).toBe(340);
  });
});

describe("caret placement", () => {
  it("keeps the caret after the last word", async () => {
    const { splitTrailingSpace } = await import("@/lib/dialogue/typewriter");
    expect(splitTrailingSpace("all along, ")).toEqual(["all along,", " "]);
    expect(splitTrailingSpace("你好")).toEqual(["你好", ""]);
  });
});
