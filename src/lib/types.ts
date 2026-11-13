export type WorldId = "western-fantasy" | "modern" | "ancient-china" | "otherworld";

export type EnvironmentTypeId = "interior" | "street" | "wilderness" | "ruins" | "dreamscape";

export type Character = {
  id: string;
  name: string;
  age: string;
  appearance: string;
  personality: string;
  background: string;
  goals: string;
  fears: string;
  habits: string;
  relationships: string;
  rules: string;
  /** Index into characterArt in src/assets/manifest.ts */
  portrait: number;
  createdAt: number;
  updatedAt: number;
};

export type CharacterTextField = Exclude<keyof Character, "id" | "portrait" | "createdAt" | "updatedAt">;

export type EnvironmentDraft = {
  description: string;
  type: EnvironmentTypeId;
};

export type Speaker = { kind: "narrator" } | { kind: "character"; name: string };

/**
 * A story line stored as a translation key + params, so the log re-renders
 * in whichever language is active. User-written text travels in params as-is.
 */
export type StoryLine = {
  speaker: Speaker;
  key: "scene.talk" | "scene.silent" | "scene.observe" | "scene.observeEmpty" | "scene.wait" | "scene.intro" | "custom";
  /** For list messages (scene.wait). */
  index?: number;
  params: Record<string, string>;
};

/** v0.2 entries are StoryLines. v0.1 saves stored plain `speaker` + `text`; both still render. */
export type LogEntry = { id: string; at: number } & (StoryLine | { speaker: string; text: string });

export type SaveData = {
  version: 1;
  worldId: WorldId | null;
  characters: Character[];
  environment: EnvironmentDraft;
  log: LogEntry[];
  updatedAt: number | null;
};

export type TextSpeed = "slow" | "normal" | "fast" | "instant";

export type Settings = {
  crt: boolean;
  reduceMotion: boolean;
  textSpeed: TextSpeed;
};
