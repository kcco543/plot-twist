"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Choice, Toggle } from "./ui/Choice";
import { PixelButton } from "./ui/PixelButton";
import { PixelIcon } from "./ui/PixelIcon";
import { LanguageSwitch } from "./LanguageSwitch";
import { updateSettings, useSettings } from "@/lib/settingsStore";
import { gameActions } from "@/lib/gameStore";
import { useI18n } from "@/i18n";
import type { TextSpeed } from "@/lib/types";

const Section = ({ children }: { children: React.ReactNode }) => <div className="border-t-[3px] border-dashed border-plum-600 pt-5">{children}</div>;

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useSettings();
  const [confirmErase, setConfirmErase] = useState(false);
  const [erased, setErased] = useState(false);

  const close = () => {
    setConfirmErase(false);
    setErased(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("settings.title")}
      closeLabel={t("common.close")}
      footer={
        <PixelButton variant="accent" onClick={close} icon="check">
          {t("common.done")}
        </PixelButton>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="font-label text-xs uppercase tracking-wide text-butter">{t("language.label")}</p>
          <LanguageSwitch full />
          <p className="text-sm text-cream-dim">{t("language.note")}</p>
        </div>
        <Section>
          <Choice<TextSpeed>
            label={t("settings.textSpeed")}
            value={settings.textSpeed}
            onChange={(textSpeed) => updateSettings({ textSpeed })}
            options={(["slow", "normal", "fast", "instant"] as const).map((v) => ({ value: v, label: t(`settings.speeds.${v}`) }))}
          />
        </Section>
        <Section>
          <div className="flex flex-col gap-5">
            <Toggle label={t("settings.crt")} description={t("settings.crtDesc")} checked={settings.crt} onChange={(crt) => updateSettings({ crt })} onLabel={t("settings.on")} offLabel={t("settings.off")} />
            <Toggle
              label={t("settings.motion")}
              description={t("settings.motionDesc")}
              checked={settings.reduceMotion}
              onChange={(reduceMotion) => updateSettings({ reduceMotion })}
              onLabel={t("settings.on")}
              offLabel={t("settings.off")}
            />
          </div>
        </Section>
        <Section>
          <p className="flex items-center gap-2 font-label text-xs uppercase tracking-wide text-butter">
            <PixelIcon name="offline" size={12} /> {t("settings.offlineTitle")}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-base leading-snug">
            <li className="flex gap-2">
              <PixelIcon name="check" size={12} className="mt-1.5 text-mint" />
              <span>{t("settings.offlineReady")}</span>
            </li>
            <li className="flex gap-2 text-cream-dim">
              <PixelIcon name="clock" size={12} className="mt-1.5 text-lavender" />
              <span>{t("settings.offlineFuture")}</span>
            </li>
          </ul>
        </Section>
        <Section>
          <p className="font-label text-xs uppercase tracking-wide text-coral">{t("settings.danger")}</p>
          <p className="mt-1 mb-3 text-base text-cream-dim">{t("settings.dangerDesc")}</p>
          {erased ? (
            <p role="status" className="font-label text-xs uppercase text-mint">
              {t("settings.erased")}
            </p>
          ) : confirmErase ? (
            <div className="flex flex-wrap gap-3">
              <PixelButton
                variant="danger"
                size="sm"
                icon="trash"
                onClick={() => {
                  gameActions.eraseAll();
                  setConfirmErase(false);
                  setErased(true);
                }}
              >
                {t("settings.eraseConfirm")}
              </PixelButton>
              <PixelButton variant="ghost" size="sm" onClick={() => setConfirmErase(false)}>
                {t("common.cancel")}
              </PixelButton>
            </div>
          ) : (
            <PixelButton variant="ghost" size="sm" icon="trash" onClick={() => setConfirmErase(true)}>
              {t("settings.erase")}
            </PixelButton>
          )}
        </Section>
      </div>
    </Modal>
  );
}
