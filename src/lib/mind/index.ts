/**
 * Behavior engine (see docs/BEHAVIOR_ENGINE.md).
 *  profile.ts   Character Profile Manager (sliders + written profile + canon limits)
 *  feelings.ts  Emotion State Manager (several feelings at once, decay)
 *  relations.ts Relationship Manager (directional A→B)
 *  memory.ts    Memory Manager (merged repeats, contradiction handling)
 *  catalog.ts   Triggers, actions and every tunable weight
 *  decide.ts    Context evaluator, candidates, hard limits, scoring, selection,
 *               expression, movement plan, dialogue style, applyDecision()
 *  speech.ts    Dialogue integration (built-in lines + AI brief)
 *  scenarios.ts Sample cast + the 10 test scenarios
 */
export * from "./catalog";
export * from "./decide";
export * from "./feelings";
export * from "./memory";
export * from "./profile";
export * from "./relations";
export * from "./scenarios";
export * from "./speech";
export * from "./beats";
