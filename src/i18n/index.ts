"use client";

/**
 * Lightweight i18n for PLOT TWIST!
 * - All UI strings live in src/i18n/locales/<locale>.json (en.json is the source of truth).
 * - useI18n() gives { locale, setLocale, t }. Switching re-renders instantly, no reload,
 *   and never touches save data, so characters and unsaved form text are kept.
 * - The chosen locale persists in localStorage.
 * - User-written content (names, bios, descriptions) is never translated.
 */
import { useCallback, useSyncExternalStore } from "react";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

type Messages = typeof en;
const MESSAGES: Record<Locale, Messages> = { en, "zh-CN": zhCN };

/** Dot-path keys of en.json whose value is a string, e.g. "title.start". */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends readonly unknown[] ? never : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
/** Keys whose value is a list of strings. */
type ListLeaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends readonly string[] ? `${P}${K}` : T[K] extends string ? never : ListLeaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type ListKey = ListLeaves<Messages>;

export type Vars = Record<string, string | number>;

function lookup(locale: Locale, key: string): unknown {
  const walk = (m: unknown) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), m);
  return walk(MESSAGES[locale]) ?? walk(MESSAGES.en);
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s);

export function translate(locale: Locale, key: MessageKey | string, vars?: Vars): string {
  const v = lookup(locale, key);
  return typeof v === "string" ? fill(v, vars) : key;
}
export function translateList(locale: Locale, key: ListKey | string): string[] {
  const v = lookup(locale, key);
  return Array.isArray(v) ? (v as string[]) : [];
}

// ---------------------------------------------------------------- locale store
const STORAGE_KEY = "plot-twist:locale";
let current: Locale | null = null;
const listeners = new Set<() => void>();

const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

function readLocale(): Locale {
  if (current) return current;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    current = isLocale(saved) ? saved : navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  } catch {
    current = "en";
  }
  return current;
}

export function setLocale(locale: Locale) {
  current = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, readLocale, () => "en");
}

export function useI18n() {
  const locale = useLocale();
  const t = useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
  const tl = useCallback((key: ListKey) => translateList(locale, key), [locale]);
  /** For keys built at runtime (e.g. world ids). Falls back to the key itself. */
  const tx = useCallback((key: string, vars?: Vars) => translate(locale, key, vars), [locale]);
  return { locale, setLocale, t, tl, tx };
}
