"use client";

import { PixelIcon, type IconName } from "@/components/ui/PixelIcon";
import { useI18n, type MessageKey } from "@/i18n";
import { useHydrated } from "@/lib/persistentStore";
import { useSyncStatus, type SyncPhase } from "@/lib/sync/client";
import { openCloudSaves } from "./cloudSavesStore";

const LOOK: Record<SyncPhase, { icon: IconName; label: MessageKey; className: string }> = {
  unconfigured: { icon: "cloud", label: "sync.badge.unconfigured", className: "bg-well text-ink-soft" },
  "signed-out": { icon: "cloud", label: "sync.badge.signedOut", className: "bg-well text-ink-soft" },
  saving: { icon: "upload", label: "sync.badge.saving", className: "bg-butter-hi text-ink" },
  synced: { icon: "check", label: "sync.badge.synced", className: "bg-mint-hi text-mint-deep" },
  offline: { icon: "offline", label: "sync.badge.offline", className: "bg-peach-hi text-ink" },
  error: { icon: "close", label: "sync.badge.error", className: "bg-coral text-ink" },
  conflict: { icon: "layers", label: "sync.badge.conflict", className: "bg-pink-hi text-ink" },
};

/** Cloud save state (Saving / Synced / Offline / Sync failed…). Opens Cloud saves. */
export function SyncBadge({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { t } = useI18n();
  const hydrated = useHydrated();
  const s = useSyncStatus();
  if (!hydrated) return null;
  const look = LOOK[s.phase];
  const label = t(look.label);
  return (
    <button
      type="button"
      onClick={() => openCloudSaves()}
      data-sync-phase={s.phase}
      aria-label={`${t("sync.open")}: ${label}`}
      title={t("sync.open")}
      className={`px-focus flex min-h-9 items-center gap-1.5 px-2 font-label text-[10px] uppercase leading-none shadow-[1px_1px_0_rgba(91,74,134,0.25)] ${look.className} ${className}`}
    >
      <PixelIcon name={look.icon} size={10} className={s.phase === "saving" ? "animate-pulse" : ""} />
      <span className={compact ? "sr-only min-[420px]:not-sr-only" : ""} aria-live="polite">
        {label}
      </span>
    </button>
  );
}
