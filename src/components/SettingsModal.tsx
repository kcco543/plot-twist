"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Choice, Toggle } from "./ui/Choice";
import { PixelButton } from "./ui/PixelButton";
import { updateSettings, useSettings } from "@/lib/settingsStore";
import { gameActions } from "@/lib/gameStore";
import type { TextSpeed } from "@/lib/types";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const [confirmErase, setConfirmErase] = useState(false);
  const [erased, setErased] = useState(false);

  const close = () => {
    setConfirmErase(false);
    setErased(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Settings" footer={<PixelButton variant="accent" onClick={close} icon="check">Done</PixelButton>}>
      <div className="flex flex-col gap-7">
        <Choice<TextSpeed>
          label="Text speed"
          value={settings.textSpeed}
          onChange={(textSpeed) => updateSettings({ textSpeed })}
          options={[
            { value: "slow", label: "Slow" },
            { value: "normal", label: "Normal" },
            { value: "fast", label: "Fast" },
            { value: "instant", label: "Instant" },
          ]}
        />
        <Toggle
          label="CRT scanlines"
          description="Old-TV lines over the whole screen."
          checked={settings.crt}
          onChange={(crt) => updateSettings({ crt })}
        />
        <Toggle
          label="Reduce motion"
          description="Turns off page transitions and bouncing."
          checked={settings.reduceMotion}
          onChange={(reduceMotion) => updateSettings({ reduceMotion })}
        />
        <div className="border-t-4 border-dashed border-ink-700 pt-6">
          <p className="font-display text-[10px] uppercase tracking-wide text-twist">Danger zone</p>
          <p className="mt-1 mb-4 text-base text-paper-dim">Deletes your world, characters and story log from this browser.</p>
          {erased ? (
            <p className="font-display text-[10px] uppercase text-mint">Save data erased.</p>
          ) : confirmErase ? (
            <div className="flex flex-wrap gap-4">
              <PixelButton
                variant="primary"
                size="sm"
                icon="trash"
                onClick={() => {
                  gameActions.eraseAll();
                  setConfirmErase(false);
                  setErased(true);
                }}
              >
                Yes, erase all
              </PixelButton>
              <PixelButton variant="ghost" size="sm" onClick={() => setConfirmErase(false)}>
                Cancel
              </PixelButton>
            </div>
          ) : (
            <PixelButton variant="danger" size="sm" icon="trash" onClick={() => setConfirmErase(true)}>
              Erase save data
            </PixelButton>
          )}
        </div>
      </div>
    </Modal>
  );
}
