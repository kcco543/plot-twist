"use client";

import { useState } from "react";
import { PixelButton } from "@/components/ui/PixelButton";
import { useI18n } from "@/i18n";

type Check = { service: "anthropic" | "openai"; model: string; result: "ok" | "missing" | "auth" | "model_missing" | "unreachable" };

/**
 * "Test connections": asks the server to check each AI key + model live
 * (a free Models API lookup, nothing is generated). "Key added" in the list
 * above only means a key is present; this says whether it actually works.
 */
export function AiConnectionCheck() {
  const { t } = useI18n();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async () => {
    setRunning(true);
    setFailed(false);
    try {
      const r = await fetch("/api/ai/check?fresh=1", { cache: "no-store" });
      const data = await r.json();
      setChecks(data.checks);
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2" data-ai-check>
      <PixelButton size="sm" variant="ghost" icon="sparkle" loading={running} onClick={run} className="self-start">
        {t("settings.aiCheck")}
      </PixelButton>
      {failed && <p className="text-sm text-coral-deep">{t("settings.aiCheckFailed")}</p>}
      {checks && (
        <ul className="flex flex-col gap-1 text-sm leading-snug" role="status">
          {checks.map((c) => (
            <li key={c.service} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>
                {t(`settings.aiService.${c.service}`)} <span className="font-label text-[9px] text-ink-mute">{c.model}</span>
              </span>
              <span className={`font-label text-[10px] uppercase ${c.result === "ok" ? "text-mint-deep" : "text-coral-deep"}`}>{t(`settings.aiResult.${c.result}`)}</span>
            </li>
          ))}
          <li className="text-ink-mute">{t("settings.aiCheckNote")}</li>
        </ul>
      )}
    </div>
  );
}
