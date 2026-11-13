"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/settingsStore";
import { useLocale } from "@/i18n";

/** Mirrors settings + language onto <html>, and registers the service worker. */
export function AppEffects() {
  const { crt, reduceMotion } = useSettings();
  const locale = useLocale();

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
