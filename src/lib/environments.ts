import type { EnvironmentTypeId } from "./types";

export type EnvironmentType = { id: EnvironmentTypeId; name: string; hint: string };

export const ENVIRONMENT_TYPES: EnvironmentType[] = [
  { id: "interior", name: "Indoor Room", hint: "Bedrooms, taverns, offices, throne rooms" },
  { id: "street", name: "Town & Street", hint: "Markets, alleys, main roads" },
  { id: "wilderness", name: "Wilderness", hint: "Forests, fields, riverbanks" },
  { id: "ruins", name: "Ruins & Dungeon", hint: "Temples, caves, forgotten places" },
  { id: "dreamscape", name: "Dreamscape", hint: "Memories, visions, impossible rooms" },
];

export const getEnvironmentType = (id: EnvironmentTypeId) =>
  ENVIRONMENT_TYPES.find((e) => e.id === id) ?? ENVIRONMENT_TYPES[0];
