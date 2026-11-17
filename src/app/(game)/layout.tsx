import { AppBar } from "@/components/AppBar";
import { CurrentWorldStrip } from "@/components/worlds/CurrentWorldStrip";

/** Shared chrome for all in-game screens (not the title screen). */
export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar />
      <CurrentWorldStrip />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
