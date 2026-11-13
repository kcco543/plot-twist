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

export type LogEntry = {
  id: string;
  at: number;
  speaker: string;
  text: string;
};

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
