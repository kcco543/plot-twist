"use client";

/**
 * Browser side of the AI features. Talks only to this app's own /api/ai/*
 * routes; the API keys stay on the server.
 */
import { useEffect, useState } from "react";
import { approvedBehavior } from "../character/model";
import { genderForPrompt } from "../character/gender";
import { finishProfile } from "../behavior/schema";
import { CHARACTER_TEXT_FIELDS, type BehaviorProfile, type Character, type Memory } from "../types";
import type { AnalyzeRequest, CharacterBrief, RefineRequest, TurnRequest } from "./contracts";
import type { AnalysisProposal } from "../behavior/refine";
import { activeWorldId } from "../saves/worldSaves";

export type AiStatus = { text: boolean; image: boolean; textModel: string | null; imageModel: string | null; talk?: "ai" | "mock" | null };
export type AiErrorCode = "not_configured" | "refused" | "invalid_output" | "rate_limited" | "auth" | "failed" | "offline" | "bad_request" | "too_large" | "bad_type" | "timeout" | "busy" | "limit" | "unsupported" | "billing";

export class AiRequestError extends Error {
  constructor(public code: AiErrorCode, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- status

let statusCache: AiStatus | null = null;
let statusPromise: Promise<AiStatus> | null = null;
const OFF: AiStatus = { text: false, image: false, textModel: null, imageModel: null };

export function fetchAiStatus(): Promise<AiStatus> {
  if (statusCache) return Promise.resolve(statusCache);
  statusPromise ??= fetch("/api/ai/status", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : OFF))
    .catch(() => OFF)
    .then((s: AiStatus) => {
      statusCache = s;
      return s;
    })
    .finally(() => {
      statusPromise = null;
    });
  return statusPromise;
}

/** null while loading. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(statusCache);
  useEffect(() => {
    let live = true;
    fetchAiStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return status;
}

/**
 * Every AI call says which world save it is for. The request bodies are built
 * from the ACTIVE world's characters (their own ids, personality, emotions,
 * relationships and memories), never from Character Library originals, and
 * replies are saved through gameStore, which only writes the active world.
 */
const worldHeader = (): Record<string, string> => {
  const id = activeWorldId();
  return id ? { "X-Plot-Twist-World": id } : {};
};

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...worldHeader() }, body: JSON.stringify(body) });
  } catch {
    throw new AiRequestError("offline", "Network error");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiRequestError((data.error as AiErrorCode) ?? "failed", data.message ?? `HTTP ${res.status}`);
  return data as T;
}

// ---------------------------------------------------------------- briefs

/** What the AI gets to see of a character: their written fields (as written), sliders, locks and approved profile. */
export function briefFor(c: Character): CharacterBrief {
  const fields = Object.fromEntries(CHARACTER_TEXT_FIELDS.map((f) => [f, c[f].slice(0, 800)]));
  const approved = approvedBehavior(c)?.profile;
  return {
    id: c.id,
    fields,
    traits: { ...c.traits },
    lockedFields: c.lockedFields,
    ...(genderForPrompt(c.gender) ? { identity: genderForPrompt(c.gender)! } : {}),
    ...(c.boundaries?.length ? { boundaries: c.boundaries.filter((b) => b.text.trim()).slice(0, 12).map((b) => ({ strength: b.strength, kind: b.kind, text: b.text.slice(0, 240) })) } : {}),
    profile: approved
      ? {
          summary: approved.summary,
          speech: approved.speech,
          boundaries: approved.boundaries,
          emotionalPatterns: approved.emotionalPatterns,
        }
      : null,
  };
}

export const memoryBrief = (m: Memory) => ({ eventType: m.eventType, withName: m.withName.slice(0, 80), note: m.note, importance: Math.min(3, Math.max(1, m.importance)) });

// ---------------------------------------------------------------- calls

export async function requestAnalysis(req: AnalyzeRequest): Promise<BehaviorProfile> {
  const data = await post<{ profile: unknown }>("/api/ai/analyze", req);
  try {
    return finishProfile(data.profile);
  } catch {
    throw new AiRequestError("invalid_output", "Profile failed validation");
  }
}

export type RefineResult = Omit<AnalysisProposal, "id" | "at" | "feedback" | "sourceVersion" | "keepCanon">;

/** Feedback → a proposed revision (nothing is applied until the player accepts it). */
export async function requestRefine(req: RefineRequest): Promise<RefineResult> {
  const data = await post<RefineResult>("/api/ai/refine", req);
  try {
    return { ...data, profile: finishProfile(data.profile) };
  } catch {
    throw new AiRequestError("invalid_output", "Profile failed validation");
  }
}

export type TurnResult = { lines: { speaker: string; text: string }[]; memoryNote: string };

export async function requestTurn(req: TurnRequest): Promise<TurnResult> {
  return post<TurnResult>("/api/ai/turn", req);
}

export async function requestSprite(image: Blob, opts: { appearance: string; world: string | null }): Promise<{ image: string; model: string }> {
  const form = new FormData();
  form.set("image", image, "reference");
  form.set("appearance", opts.appearance);
  if (opts.world) form.set("world", opts.world);
  let res: Response;
  try {
    res = await fetch("/api/ai/sprite", { method: "POST", body: form, headers: worldHeader() });
  } catch {
    throw new AiRequestError("offline", "Network error");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiRequestError((data.error as AiErrorCode) ?? "failed", data.message ?? `HTTP ${res.status}`);
  return data;
}

export type MapRequestBody = { description: string; type: string; world: string | null };

/** Description → generated map (data URL). Takes up to a minute or two. */
export async function requestMap(body: MapRequestBody): Promise<{ image: string; model: string }> {
  return post<{ image: string; model: string }>("/api/ai/map", body);
}

/** Gift name + description → generated item picture (data URL). Only when image generation is configured. */
export async function requestGiftImage(body: { name: string; description: string; world: string | null }): Promise<{ image: string; model: string }> {
  return post<{ image: string; model: string }>("/api/ai/gift", body);
}

export type MapEditBody = { instruction: string; region: { x: number; y: number; w: number; h: number }; description: string; type: string | null; world: string | null };

/** Current map + selected area + instruction → the map with that area repainted (data URL). */
export async function requestMapEdit(image: Blob, body: MapEditBody): Promise<{ image: string; model: string }> {
  const form = new FormData();
  form.set("image", image, "map");
  form.set("instruction", body.instruction);
  for (const k of ["x", "y", "w", "h"] as const) form.set(k, String(body.region[k]));
  form.set("description", body.description);
  if (body.type) form.set("type", body.type);
  if (body.world) form.set("world", body.world);
  let res: Response;
  try {
    res = await fetch("/api/ai/map/edit", { method: "POST", body: form });
  } catch {
    throw new AiRequestError("offline", "Network error");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiRequestError((data.error as AiErrorCode) ?? "failed", data.message ?? `HTTP ${res.status}`);
  return data;
}
