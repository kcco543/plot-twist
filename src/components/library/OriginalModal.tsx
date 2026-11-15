"use client";

import { Modal } from "@/components/ui/Modal";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useLibrary } from "@/lib/library/characterLibrary";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";
import { TemplatePreview } from "./TemplateCard";

const SHOWN = ["appearance", "personality", "background", "goals", "fears", "habits", "speakingStyle", "rules", "canon"] as const;

/** Studio → "View Original Character": the library original, read-only, next to this world's version. */
export function OriginalModal({ character, onClose, onEditHere }: { character: Character | null; onClose: () => void; onEditHere: () => void }) {
  const { t, tx } = useI18n();
  const library = useLibrary();
  const tpl = character?.templateId ? library.templates.find((x) => x.id === character.templateId) : undefined;
  const name = character?.name.trim() || t("common.unnamed");
  return (
    <Modal
      open={character !== null}
      onClose={onClose}
      title={t("library.originalTitle")}
      closeLabel={t("common.close")}
      size="lg"
      footer={
        <>
          {tpl && (
            <PixelLink href={`/library?open=${encodeURIComponent(tpl.id)}`} variant="ghost" size="sm" icon="book">
              {t("library.openLibrary")}
            </PixelLink>
          )}
          <PixelButton variant="accent" size="sm" icon="pencil" onClick={onEditHere}>
            {t("library.editThis")}
          </PixelButton>
        </>
      }
    >
      {!tpl ? (
        <p className="flex items-start gap-2 bg-well px-3 py-3 text-lg">
          <PixelIcon name="book" size={14} className="mt-1 shrink-0 text-ink-mute" />
          {t("library.originalMissing")}
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-original={tpl.id}>
          <p className="bg-lavender-hi px-3 py-2 text-base leading-snug text-ink shadow-[inset_4px_0_0_var(--color-lavender)]">{t("library.originalNote", { name })}</p>
          <TemplatePreview character={tpl} />
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            {SHOWN.filter((f) => tpl[f].trim()).map((f) => (
              <div key={f} className="contents">
                <dt className="font-label text-[10px] uppercase text-rose sm:pt-1">{tx(`character.fields.${f}.label`)}</dt>
                <dd className="whitespace-pre-line text-base leading-snug [overflow-wrap:anywhere]">{tpl[f]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Modal>
  );
}
