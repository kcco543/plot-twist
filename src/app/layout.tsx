import type { Metadata, Viewport } from "next";
import { Noto_Sans_SC, Pixelify_Sans, Press_Start_2P, Silkscreen, ZCOOL_QingKe_HuangYou } from "next/font/google";
import { AppEffects } from "@/components/AppEffects";
import "./globals.css";

// Latin pixel faces
const pressStart = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-press-start" });
const pixelify = Pixelify_Sans({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-pixelify" });
const silkscreen = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-silkscreen" });
// Chinese faces: loaded on demand (unicode-range), so not preloaded
const zcool = ZCOOL_QingKe_HuangYou({ weight: "400", subsets: ["latin"], variable: "--font-zcool", preload: false });
const notoSC = Noto_Sans_SC({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-noto-sc", preload: false });

export const metadata: Metadata = {
  title: "PLOT TWIST!",
  description: "You create the characters. They create the chaos. 角色由你创造，混乱由他们制造。",
  applicationName: "PLOT TWIST!",
  appleWebApp: { capable: true, title: "PLOT TWIST!", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#30273f",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${pressStart.variable} ${pixelify.variable} ${silkscreen.variable} ${zcool.variable} ${notoSC.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <AppEffects />
        {children}
      </body>
    </html>
  );
}
