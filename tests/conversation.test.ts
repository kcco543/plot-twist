import { describe, expect, it } from "vitest";
import { roomFor, standGap } from "@/lib/stage/room";
import { ENDING_HOLD_MS, INTENT_MS, StageSim } from "@/lib/stage/sim";
import type { Character } from "@/lib/types";
import { makeChar } from "./helpers";

/** Stationary conversation: people who are talking stay where they are unless the move is intentional. */
function setup(cast: Character[] = [makeChar({ id: "a" }), makeChar({ id: "b" }), makeChar({ id: "c" })]) {
  const room = roomFor("modern", "interior");
  const sim = new StageSim({ room, idle: false });
  sim.setCast(cast);
  sim.spawnAt("a", { x: 100, y: 160 });
  sim.spawnAt("b", { x: 130, y: 160 });
  sim.spawnAt("c", { x: 250, y: 160 });
  return { sim };
}
const run = (sim: StageSim, ms: number) => {
  for (let t = 0; t < ms; t += 16) sim.tick(16);
};

describe("stationary conversation", () => {
  it("moves through approaching, in conversation, ending and disengaged", () => {
    const { sim } = setup();
    sim.spawnAt("b", { x: 220, y: 160 });
    expect(sim.conversationPhase("a")).toBe("disengaged");
    expect(sim.request({ type: "approach", actor: "a", target: "b", distance: 24 }, "conversation", "player").ok).toBe(true);
    sim.markApproaching("a", "b");
    expect(sim.conversationPhase("a")).toBe("approaching");
    run(sim, 4000);
    sim.beginConversation(["a", "b"]);
    expect(sim.conversationPhase("a")).toBe("in_conversation");
    expect(sim.conversationPhase("c")).toBe("disengaged");
    sim.endConversation();
    expect(sim.conversationPhase("a")).toBe("ending");
    run(sim, ENDING_HOLD_MS + 50);
    expect(sim.conversationPhase("a")).toBe("disengaged");
  });

  it("holds routine walks and object use while talking, and right after", () => {
    const { sim } = setup();
    sim.beginConversation(["a", "b"]);
    const r = sim.request({ type: "walk_to", actor: "a", x: 200, y: 165 }, "event", "auto");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("in_conversation");
    expect(sim.request({ type: "walk_to", actor: "b", x: 200, y: 165 }, "event", "story").ok).toBe(false);
    // Someone not in the conversation walks freely.
    expect(sim.request({ type: "walk_to", actor: "c", x: 200, y: 165 }, "event", "auto").ok).toBe(true);
    sim.endConversation();
    expect(sim.request({ type: "walk_to", actor: "a", x: 200, y: 165 }, "event", "auto").ok).toBe(false);
    run(sim, ENDING_HOLD_MS + 50);
    expect(sim.request({ type: "walk_to", actor: "a", x: 200, y: 165 }, "event", "auto").ok).toBe(true);
  });

  it("an approach to a partner who is already close becomes a turn; a far one closes the gap", () => {
    const { sim } = setup();
    sim.beginConversation(["a", "b"]);
    const p0 = sim.position("a")!;
    const r = sim.request({ type: "approach", actor: "a", target: "b", distance: 20 }, "conversation", "story");
    expect(r.ok && r.action.type).toBe("face_target");
    run(sim, 1000);
    expect(sim.position("a")).toEqual(p0);
    // Pushed far apart: walking back is allowed.
    sim.spawnAt("b", { x: 230, y: 160 });
    const far = sim.request({ type: "approach", actor: "a", target: "b", distance: 20 }, "conversation", "story");
    expect(far.ok && far.action.type).toBe("approach");
  });

  it("idle shuffles become fidgets in place", () => {
    const { sim } = setup();
    sim.beginConversation(["a", "b"]);
    const p0 = sim.position("a")!;
    const r = sim.request({ type: "idle_reaction", actor: "a", kind: "shift" }, "conversation", "story");
    expect(r.ok && r.action.type === "idle_reaction" && r.action.kind).toBe("look_around");
    run(sim, 1200);
    expect(sim.position("a")).toEqual(p0);
  });

  it("stepping back needs a feeling behind it", () => {
    const { sim } = setup();
    sim.beginConversation(["a", "b"]);
    const calm = sim.request({ type: "retreat", actor: "b", from: "a", distance: 16 }, "conversation", "story");
    expect(calm.ok && calm.action.type).toBe("face_target");
    sim.syncEmotion("b", "angry", 3, 1);
    const angry = sim.request({ type: "retreat", actor: "b", from: "a", distance: 16 }, "conversation", "story");
    expect(angry.ok && angry.action.type).toBe("retreat");
    expect(sim.conversationPhase("b")).toBe("intentional");
    const before = standGap(sim.position("a")!, sim.position("b")!);
    run(sim, 1500);
    expect(standGap(sim.position("a")!, sim.position("b")!)).toBeGreaterThan(before);
  });

  it("intentional exceptions: the player's command, walking off, following someone", () => {
    const { sim } = setup();
    sim.beginConversation(["a", "b"]);
    // The player drags someone away: always allowed.
    expect(sim.request({ type: "walk_to", actor: "a", x: 220, y: 170 }, "test", "player").ok).toBe(true);
    expect(sim.conversationPhase("a")).toBe("intentional");
    // The story says b leaves (ended the conversation / follows someone).
    sim.leaveConversation("b");
    expect(sim.request({ type: "approach", actor: "b", target: "c", distance: 24 }, "event", "story").ok).toBe(true);
    run(sim, INTENT_MS + 100);
    expect(sim.conversationPhase("b")).toBe("in_conversation");
  });

  it("a routine walk interrupted by the conversation is not resumed when a line ends", () => {
    const { sim } = setup();
    expect(sim.request({ type: "walk_to", actor: "a", x: 60, y: 175 }, "event", "auto").ok).toBe(true);
    run(sim, 100);
    sim.setSpeaker("a"); // suspends the walk
    sim.beginConversation(["a", "b"]);
    sim.setSpeaker(null);
    expect(sim.walkOf("a")).toBeNull();
    const p0 = sim.position("a")!;
    run(sim, 1500);
    expect(sim.position("a")).toEqual(p0);
  });
});
