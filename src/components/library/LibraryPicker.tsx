"use client";

import { Modal } from "@/components/ui/Modal";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useLibrary, type CharacterTemplate } from "@/lib/library/characterLibrary";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";
import { TemplatePreview } from "./TemplateCard";

/** Studio → "Add from Library": browse originals with a preview, add one to this world as its own copy. */
export function LibraryPicker({ open, onClose, worldName, cast, onPick }: { open: boolean; onClose: () => void; worldName: string; cast: Character[]; onPick: (t: CharacterTemplate) => void }) {
  const { t } = useI18n();
  const library = useLibrary();
  const here = new Set(cast.map((c) => c.templateId).filter(Boolean));
  return (
    <Modal open={open} onClose={onClose} title={t("library.pickTitle")} closeLabel={t("common.close")} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-lg leading-snug text-ink-soft">{t("library.pickIntro", { world: worldName })}</p>
        {library.templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 bg-well px-3 py-6 text-center">
            <PixelIcon name="book" size={28} className="text-ink-mute" />
            <p className="text-base text-ink-soft">{t("library.pickEmpty")}</p>
            <PixelLink href="/library" variant="ghost" size="sm" icon="book">
              {t("library.openLibrary")}
            </PixelLink>
          </div>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t("library.list")}>
            {library.templates.map((tpl) => (
              <li key={tpl.id} className="px-frame" style={{ "--frame": "var(--frame-card)" } as React.CSSProperties}>
                <div className="flex flex-col gap-3 p-1 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <TemplatePreview character={tpl}>
                      {here.has(tpl.id) && (
                        <span className="mt-1 inline-flex w-fit items-center gap-1 bg-mint-hi px-1.5 py-0.5 font-label text-[10px] uppercase text-mint-deep">
                          <PixelIcon name="check" size={9} /> {t("library.alreadyHere")}
                        </span>
                      )}
                    </TemplatePreview>
                  </div>
                  <PixelButton variant="primary" size="sm" icon="plus" onClick={() => onPick(tpl)} className="w-full shrink-0 sm:w-auto" data-template={tpl.id}>
                    {t("library.addThis")}
                  </PixelButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
