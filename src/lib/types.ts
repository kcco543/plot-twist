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
  /**
   * The Character Library original this world's character was added from
   * (read-only link; see src/lib/library). Missing = made in this world.
   * Everything else on the character is this world's own copy.
   */
  templateId?: string;
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

/** What kind of moment a memory is (behavior engine). Older memories have none; see memoryKindOf(). */
export const MEMORY_KINDS = ["helped", "argument", "rejected", "complimented", "criticized", "promise", "secret", "reunion", "betrayed", "provoked", "cooperated", "teased", "met"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type Memory = {
  id: string;
  turn: number;
  eventType: string;
  /** Behavior-engine category. Repeats of the same kind with the same person are merged (see count). */
  kind?: MemoryKind;
  /** How many times this has happened (merged repeats). */
  count?: number;
  reaction: Reaction | null;
  withId: string | null;
  withName: string;
  mood: Mood;
  /** 1 (minor) to 3 (unforgettable). */
  importance: number;
  /** Short AI-written note, in the language it was written in (the player can correct it). */
  note: string | null;
  at: number;
  /** Unfinished business this memory carries (AI conversations). */
  thread?: MemoryThread;
  /** The thread was settled later (by a conversation, or by the player). */
  resolved?: boolean;
  /** Written by an AI conversation; "player" once the player has edited it. */
  source?: "ai" | "mock" | "player";
};

export type MemoryThread = "conflict" | "promise" | "discovery" | "secret";

/** One spoken line in a conversation between two characters (AI conversations keep the last few per pair). */
export type TalkLine = { from: string; text: string; turn: number; at: number; source: "ai" | "mock" | "builtin" | "player" };

/** A relationship shift from an AI conversation, kept so later replies know how things have moved. */
export type RelationShift = { turn: number; from: string; to: string; delta: Partial<Record<"trust" | "affection" | "respect" | "tension", number>>; why: string };

export type CharacterState = {
  mood: Mood;
  intensity: number;
  memories: Memory[];
  /**
   * Current emotion (see src/lib/emotion/emotions.ts). Separate from the
   * permanent personality in Character.traits. Missing in older saves = neutral.
   */
  emotion?: import("./emotion/emotions").Emotion;
  /** 0 (none) to 3 (strong). Fades by one each turn the character isn't involved. */
  emotionLevel?: number;
  /** When the emotion was last set (ms), so effects replay on a repeat of the same emotion. */
  emotionAt?: number;
  /**
   * Behavior engine: everything the character feels right now, 0–100 per
   * dimension. Several can be high at once (affection + embarrassment).
   * `emotion` above is only what SHOWS; this is what is felt.
   */
  feelings?: Feelings;
};

// ---------------------------------------------------------------- behavior engine state

/** Temporary feelings. Kept apart from personality (Character.traits), which never changes by itself. */
export const FEELINGS = ["happiness", "anger", "sadness", "fear", "anxiety", "excitement", "embarrassment", "affection", "frustration", "surprise", "confusion"] as const;
export type Feeling = (typeof FEELINGS)[number];
export type Feelings = Partial<Record<Feeling, number>>;

/** Directional: how one character feels about ANOTHER. A→B can differ from B→A. */
export type Relation = {
  /** −100…100 */
  trust: number;
  /** −100…100 */
  affection: number;
  /** −100…100 */
  respect: number;
  /** 0…100 (0 = stranger) */
  familiarity: number;
  /** 0…100 */
  rivalry: number;
  /** 0…100 */
  tension: number;
  /** 0…100: how much they fear the other. */
  fear: number;
  /** Label read from the written relationships text (friend, rival…). Context only: it never decides a reaction by itself. */
  label?: RelationLabel;
};
export const RELATION_LABELS = ["stranger", "acquaintance", "friend", "family", "partner", "rival", "enemy"] as const;
export type RelationLabel = (typeof RELATION_LABELS)[number];

/** One behavior decision, kept for repetition penalties and cooldowns. */
export type DecisionRecord = { turn: number; actorId: string; otherId: string | null; trigger: string; action: string; at: number };

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
  /** Behavior engine: directional relationships, keyed "fromId>toId". Missing = read from the written relationships text. */
  relations?: Record<string, Relation>;
  /** Behavior engine: recent decisions (most recent last, capped). */
  decisions?: DecisionRecord[];
  /** AI conversations: recent lines per pair (keyed by bondKey), most recent last, capped. */
  talk?: Record<string, TalkLine[]>;
  /** AI conversations: recent relationship shifts per direction (keyed "fromId>toId"), capped. */
  relationLog?: Record<string, RelationShift[]>;
};

// ---------------------------------------------------------------- save

export type EnvironmentDraft = {
  description: string;
  type: EnvironmentTypeId;
  /** The generated map in use (stored in the browser's map library), or null for the built-in art. */
  mapId?: string | null;
};

export type Speaker = { kind: "narrator" } | { kind: "character"; name: string; id?: string };

/**
 * A story line stored as a translation key + params, so the log re-renders
 * in whichever language is active. User-written text travels in params as-is.
 * `tpl` lines name any translation key (a string or a list picked by `index`).
 * `custom` lines carry finished text (player-written, or AI-written in the
 * language that was active when it was generated).
 * `behave` lines are behavior-engine replies: `tpl` = behave.say.<action>,
 * params len / group / pre (hesitation) / addr (use the listener's name).
 */
export type StoryLine = {
  speaker: Speaker;
  key: "scene.talk" | "scene.silent" | "scene.observe" | "scene.observeEmpty" | "scene.wait" | "scene.intro" | "custom" | "tpl" | "behave";
  tpl?: string;
  /** For list messages. */
  index?: number;
  params: Record<string, string>;
  /** Where the line came from, shown as a tiny tag in the log ("mock" = developer TEST reply, never real AI). */
  source?: "ai" | "builtin" | "mock";
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
  /** Show the emotion & movement test panel under the dialogue in Play Mode. */
  testPanel?: boolean;
  /** Developer-only Behavior Debug Panel (only offered in development builds or after opening /play?dev=1). */
  behaviorDebug?: boolean;
};
