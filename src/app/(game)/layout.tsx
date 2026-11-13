import { AppBar } from "@/components/AppBar";

/** Shared chrome for all in-game screens (not the title screen). */
export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
