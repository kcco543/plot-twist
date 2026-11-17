"use client";

import { useId, useState, type FormEvent } from "react";
import { lockBeta, unlockBeta, useAiStatus, type UnlockResult } from "@/lib/ai/client";
import { useI18n } from "@/i18n";
import { Panel } from "./ui/Panel";
import { PixelButton } from "./ui/PixelButton";

/**
 * Public beta welcome: what the game is, how to start, where saves live, and
 * the tester-code form that turns the AI on for this browser. The code is
 * checked on the server (/api/beta/unlock); this form only sends it.
 */
export function BetaPanel() {
  const { t } = useI18n();
  const ai = useAiStatus();
  const id = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Exclude<UnlockResult, { ok: true }>["error"] | null>(null);

  const beta = ai?.beta;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    const r = await unlockBeta(code);
    setBusy(false);
    if (r.ok) setCode("");
    else setError(r.error);
  };

  return (
    <Panel title={t("beta.title")} className="mx-auto w-full max-w-2xl">
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink">
        <p>{t("beta.intro")}</p>
        <div>
          <p className="font-label text-xs uppercase text-label">{t("beta.stepsTitle")}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-6 text-ink-soft">
            <li>{t("beta.step1")}</li>
            <li>{t("beta.step2")}</li>
            <li>{t("beta.step3")}</li>
            <li>{t("beta.step4")}</li>
          </ol>
        </div>
        <p className="text-ink-soft">{t("beta.savesNote")}</p>

        {beta && !beta.textAvailable && <p className="font-semibold">{t("beta.aiUnavailable")}</p>}

        {beta?.required && beta.textAvailable && !beta.unlocked && (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <p className="font-semibold">{t("beta.aiLocked")}</p>
            <label htmlFor={id} className="font-label text-xs uppercase text-label">
              {t("beta.codeLabel")}
            </label>
            <div className="flex flex-wrap items-stretch gap-2">
              <input
                id={id}
                className="px-input min-w-0 flex-1"
                value={code}
                maxLength={100}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={t("beta.codePlaceholder")}
                aria-describedby={error ? `${id}-err` : undefined}
                onChange={(e) => setCode(e.target.value)}
              />
              <PixelButton type="submit" variant="magic" size="md" disabled={busy || !code.trim()} loading={busy}>
                {busy ? t("beta.checking") : t("beta.unlock")}
              </PixelButton>
            </div>
            {error && (
              <p id={`${id}-err`} role="alert" className="text-sm font-semibold text-rose">
                {t(`beta.err.${error}`)}
              </p>
            )}
          </form>
        )}

        {beta?.unlocked && beta.textAvailable && (
          <div className="flex flex-col gap-2">
            <p className="font-semibold">{t("beta.aiUnlocked")}</p>
            {beta.allowance && <p className="text-ink-soft">{t("beta.allowance", { text: beta.allowance.text, auto: beta.allowance.auto })}</p>}
            <p className="text-ink-soft">{beta.imageAvailable && beta.allowance ? t("beta.imagesOn", { images: beta.allowance.images }) : t("beta.imagesOff")}</p>
            {beta.required && (
              <div>
                <PixelButton variant="ghost" size="sm" onClick={() => void lockBeta()}>
                  {t("beta.lock")}
                </PixelButton>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
