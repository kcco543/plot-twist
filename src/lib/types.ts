export type WorldId = "western-fantasy" | "modern" | "ancient-china" | "otherworld";

export type EnvironmentTypeId = "interior" | "street" | "wilderness" | "ruins" | "dreamscape";

// ---------------------------------------------------------------- personality

/**
 * Personality sliders. Each runs 0–100 from the LEFT tendency to the RIGHT one
 * (e.g. extroversion 0 = introverted, 100 = extroverted). Labels live in
 * traits.<id> in the locale files. A missing value means "not set".
 */
export const TRAIT_IDS = [
  "extroversion",
  "impulsiveness",
  "expressiveness",
  "trust",
  "idealism",
  "dependence",
  "confrontation",
  "playfulness",
  "empathy",
  "rebelliousness",
] as const;
export type TraitId = (typeof TRAIT_IDS)[number];
export type Traits = Partial<Record<TraitId, number>>;

/** Everything the player can write about a character. */
export const CHARACTER_TEXT_FIELDS = [
  "name",
  "age",
  "identity",
  "appearance",
  "personality",
  "background",
  "goals",
  "fears",
  "values",
  "rules",
  "habits",
  "speakingStyle",
  "relationships",
  "canon",
] as const;
export type CharacterTextField = (typeof CHARACTER_TEXT_FIELDS)[number];

/** Custom art made in the Sprite Studio. Data URLs, stored with the save. */
export type CharacterArt = {
  assetId: string;
  /** 32×32 standing sprite (PNG data URL). */
  sprite: string;
  /** 96×96 portrait (PNG data URL). */
  portrait: string;
  source: SpriteSource;
};
export type SpriteSource = "ai" | "converted" | "edited";

/** A saved sprite in the player's library, reusable by any character. */
export type SpriteAsset = CharacterArt & { name: string; createdAt: number };

export type Character = Record<CharacterTextField, string> & {
  id: string;
  /** Index into characterArt in src/assets/manifest.ts (used when `art` is null). */
  portrait: number;
  /** Custom sprite + portrait, or null to use the placeholder `portrait` index. */
  art: CharacterArt | null;
  traits: Traits;
  /** Written fields the AI must treat as fixed canon (it never edits any field). */
  lockedFields: CharacterTextField[];
  /** Conflict ids (written vs. sliders) the player reviewed and chose to keep. */
  resolvedConflicts: string[];
  /** AI (or built-in) personality analysis. Only used in play once approved. */
  behavior: BehaviorRecord | null;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------- behavior

export const REACTIONS = ["confront", "deflect", "withdraw", "comfort", "joke", "investigate", "act", "cooperate"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const APPROACHES = ["direct", "guarded", "warm", "teasing", "probing", "rambling", "formal", "curt"] as const;
export type Approach = (typeof APPROACHES)[number];

export const MOODS = ["calm", "happy", "anxious", "irritated", "sad", "excited", "suspicious", "embarrassed"] as const;
export type Mood = (typeof MOODS)[number];

/** Structured behavioral profile. Same shape whether written by the AI or by the built-in analyzer. */
export type BehaviorProfile = {
  summary: string;
  coreTraits: { label: string; evidence: string; source: "written" | "sliders" | "both" }[];
  speech: { register: string; length: "terse" | "measured" | "chatty"; tics: string[]; avoids: string[]; sample: string };
  emotionalPatterns: { trigger: string; reaction: string; variation: string }[];
  decisionStyle: string;
  socialStyle: string;
  motivations: string[];
  boundaries: string[];
  dialogueApproaches: Approach[];
  /** 0–100 weights the event engine uses when choosing how this character reacts. */
  reactionTendencies: Record<Reaction, number>;
  conflicts: { traitId: TraitId | null; written: string; slider: string; note: string }[];
  storyHooks: string[];
};

export type BehaviorRecord = {
  profile: BehaviorProfile;
  source: "ai" | "local";
  status: "pending" | "approved";
  /** Hash of the profile inputs, to tell when the analysis is out of date. */
  inputHash: string;
  locale: string;
  createdAt: number;
  approvedAt: number | null;
};

// ---------------------------------------------------------------- story state

export type Memory = {
  id: string;
  turn: number;
  eventType: string;
  reaction: Reaction | null;
  withId: string | null;
  withName: string;
  mood: Mood;
  /** 1 (minor) to 3 (unforgettable). */
  importance: number;
  /** Short AI-written note, in the language it was written in. */
  note: string | null;
  at: number;
};

export type CharacterState = { mood: Mood; intensity: number; memories: Memory[] };

/** Rule-controlled numbers between two characters. The written relationships text is never changed. */
export type Bond = { affinity: number; trust: number };

export type EventRecord = {
  id: string;
  turn: number;
  type: string;
  actorId: string;
  otherId: string | null;
  reaction: Reaction | null;
  approach: Approach;
  /** Template variant used by the built-in writer (for repetition control). */
  variant: number;
  at: number;
};

export type StoryState = {
  turn: number;
  characters: Record<string, CharacterState>;
  /** Keyed by bondKey(a, b). */
  bonds: Record<string, Bond>;
  /** Most recent last, capped. */
  events: EventRecord[];
};

// ---------------------------------------------------------------- save

export type EnvironmentDraft = {
  description: string;
  type: EnvironmentTypeId;
};

export type Speaker = { kind: "narrator" } | { kind: "character"; name: string; id?: string };

/**
 * A story line stored as a translation key + params, so the log re-renders
 * in whichever language is active. User-written text travels in params as-is.
 * `tpl` lines name any translation key (a string or a list picked by `index`).
 * `custom` lines carry finished text (player-written, or AI-written in the
 * language that was active when it was generated).
 */
export type StoryLine = {
  speaker: Speaker;
  key: "scene.talk" | "scene.silent" | "scene.observe" | "scene.observeEmpty" | "scene.wait" | "scene.intro" | "custom" | "tpl";
  tpl?: string;
  /** For list messages. */
  index?: number;
  params: Record<string, string>;
  /** Where the line came from, shown as a tiny tag in the log. */
  source?: "ai" | "builtin";
};

/** v0.2 entries are StoryLines. v0.1 saves stored plain `speaker` + `text`; both still render. */
export type LogEntry = { id: string; at: number } & (StoryLine | { speaker: string; text: string });

export type SaveData = {
  version: 1;
  worldId: WorldId | null;
  characters: Character[];
  environment: EnvironmentDraft;
  log: LogEntry[];
  story: StoryState;
  /** Saved sprites, reusable by any character. */
  sprites: SpriteAsset[];
  updatedAt: number | null;
};

export type TextSpeed = "slow" | "normal" | "fast" | "instant";
export type EventFrequency = "calm" | "normal" | "chaotic";

export type Settings = {
  crt: boolean;
  reduceMotion: boolean;
  textSpeed: TextSpeed;
  /** How often waiting turns into an event. */
  eventFrequency: EventFrequency;
  /** Use the AI writer for dialogue when it is configured. */
  aiStory: boolean;
};
