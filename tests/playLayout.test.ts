import { describe, expect, it } from "vitest";
import { MIN_PLAY_H, choosePlayShape, sideDockMin, stackDockHeight } from "@/lib/playLayout";
import { tidyLine } from "@/lib/dialogue/typewriter";

describe("choosePlayShape", () => {
  it("puts the dialogue beside the viewport on desktop, laptop and tablet landscape", () => {
    for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768]]) expect(choosePlayShape(w, h)).toBe("side");
  });
  it("stacks on tablet and phone portrait", () => {
    for (const [w, h] of [[768, 1024], [390, 844], [375, 667], [820, 1180]]) expect(choosePlayShape(w, h)).toBe("stack");
  });
  it("uses side by side on phones held sideways", () => {
    expect(choosePlayShape(844, 390)).toBe("side");
    expect(choosePlayShape(667, 375)).toBe("side");
  });
  it("looks at height, not width alone: a tall narrow desktop window stacks", () => {
    expect(choosePlayShape(1000, 1100)).toBe("stack");
  });
});

describe("dock sizes", () => {
  it("keeps a usable dock under the viewport when stacked", () => {
    expect(stackDockHeight(MIN_PLAY_H.stack)).toBeGreaterThanOrEqual(268);
    expect(stackDockHeight(2000)).toBe(380);
  });
  it("never asks for more than the play area beside the viewport", () => {
    expect(sideDockMin(300)).toBe(300);
    expect(sideDockMin(900)).toBe(420);
  });
});

describe("tidyLine", () => {
  it("drops blank lines and edge whitespace but keeps single breaks", () => {
    expect(tidyLine("\n\n  Hello.  \n\n\nHow are you?\n")).toBe("Hello.\nHow are you?");
    expect(tidyLine("你好。\r\n\r\n再见。")).toBe("你好。\n再见。");
    expect(tidyLine("One line")).toBe("One line");
  });
});
