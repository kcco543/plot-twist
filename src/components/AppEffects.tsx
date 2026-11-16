"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/settingsStore";
import { useI18n, useLocale } from "@/i18n";
import { setCopyNamer, startSync } from "@/lib/sync/client";

/** Mirrors settings + language onto <html>, and registers the service worker. */
export function AppEffects() {
  const { crt, reduceMotion } = useSettings();
  const locale = useLocale();
  const { t } = useI18n();

  // Cloud saves: sign-in state, automatic sync, sync status (src/lib/sync/client.ts).
  useEffect(() => {
    setCopyNamer((name) => t("sync.copyName", { name: name || t("sync.unnamed") }));
    startSync();
  }, [t]);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.crt = crt ? "on" : "off";
    el.dataset.motion = reduceMotion ? "reduced" : "full";
  }, [crt, reduceMotion]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is optional */
    });
  }, []);

  return null;
}
