"use client";

import { ScreenHeader } from "@/components/ScreenHeader";
import { MyWorlds } from "@/components/worlds/MyWorlds";
import { PixelLink } from "@/components/ui/PixelButton";
import { useI18n } from "@/i18n";

/** Load Game: the same My Worlds shelf as the title screen. */
export default function LoadGamePage() {
  const { t } = useI18n();
  return (
    <main className="content-grid flex-1 py-8 sm:py-10">
      <ScreenHeader kicker={t("load.kicker")} title={t("myWorlds.heading")} />
      <MyWorlds showHeading={false} />
      <div className="mt-10">
        <PixelLink href="/" variant="ghost" icon="left">
          {t("common.title")}
        </PixelLink>
      </div>
    </main>
  );
}
