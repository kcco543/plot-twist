import type { Metadata, Viewport } from "next";
import { Pixelify_Sans, Press_Start_2P } from "next/font/google";
import { SettingsEffect } from "@/components/SettingsEffect";
import "./globals.css";

const display = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-press-start" });
const body = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixelify" });

export const metadata: Metadata = {
  title: "PLOT TWIST!",
  description: "You create the characters. They create the chaos. A pixel-art storytelling sandbox for original characters.",
};

export const viewport: Viewport = { themeColor: "#160f2b" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">
        <SettingsEffect />
        {children}
      </body>
    </html>
  );
}
