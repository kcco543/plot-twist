"use client";

import { useCallback } from "react";
import { useI18n } from "@/i18n";
import { currentAccountId } from "@/lib/sync/account";
import { getBackup } from "@/lib/sync/backups";
import { buildExport, copyBundle, downloadExport, exportFileName, exportFromBundles, importBundles, parseExport } from "@/lib/sync/transfer";
import { writeLocalBundle } from "@/lib/sync/local";

export type Notice = { text: string; error?: boolean };

/** Export Save / Import Save / backup actions, with messages ready to show. */
export function useTransferActions() {
  const { t } = useI18n();

  const exportWorlds = useCallback(
    async (ids: string[], name: string): Promise<Notice> => {
      const file = await buildExport(ids);
      const filename = exportFileName(name);
      downloadExport(file, filename);
      return { text: t("sync.exported", { file: filename }) };
    },
    [t],
  );

  const importFile = useCallback(
    async (file: File): Promise<Notice> => {
      let parsed;
      try {
        parsed = await parseExport(await file.text());
      } catch {
        return { text: t("sync.importInvalid"), error: true };
      }
      if (!parsed.worlds.length) return { text: t("sync.importInvalid"), error: true };
      try {
        const owner = currentAccountId() ?? undefined;
        const results = await importBundles(parsed.worlds, parsed.blobs, owner, (n) => t("sync.importedCopyName", { name: n || t("sync.unnamed") }));
        const list = results
          .map((r) => {
            const name = r.name || t("sync.unnamed");
            return r.status === "same" ? t("sync.importedSame", { name }) : r.status === "copied" ? t("sync.importedCopy", { name }) : t("sync.importedNew", { name });
          })
          .join("; ");
        const extra = parsed.invalid ? ` ${t("sync.importSomeInvalid", { count: parsed.invalid })}` : "";
        return { text: t("sync.imported", { list }) + extra };
      } catch {
        return { text: t("sync.importFailed"), error: true };
      }
    },
    [t],
  );

  const downloadBackup = useCallback(
    async (id: string): Promise<Notice | null> => {
      const b = await getBackup(id);
      if (!b) return null;
      const file = await exportFromBundles([b]);
      const filename = exportFileName(`${b.name || "world"}-backup`, new Date(b.at));
      downloadExport(file, filename);
      return { text: t("sync.exported", { file: filename }) };
    },
    [t],
  );

  /** Bring a backup back as a separate, new world (never over the current one). */
  const restoreBackup = useCallback(
    async (id: string, displayName: string): Promise<Notice | null> => {
      const b = await getBackup(id);
      if (!b) return null;
      const name = t("sync.restoredName", { name: displayName });
      try {
        await writeLocalBundle(copyBundle(b.bundle, name), new Map(Object.entries(b.blobs)), currentAccountId() ?? undefined);
        return { text: t("sync.restored", { name }) };
      } catch {
        return { text: t("sync.importFailed"), error: true };
      }
    },
    [t],
  );

  return { exportWorlds, importFile, downloadBackup, restoreBackup };
}
