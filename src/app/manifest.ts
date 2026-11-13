import type { MetadataRoute } from "next";

/** Web app manifest: lets PLOT TWIST! be installed to a phone home screen or desktop. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PLOT TWIST!",
    short_name: "PLOT TWIST!",
    description: "You create the characters. They create the chaos. 角色由你创造，混乱由他们制造。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#30273f",
    theme_color: "#30273f",
    categories: ["games", "entertainment"],
    lang: "en",
    // Placeholder icons (scripts/generate-placeholders.mjs). Replace with final branded icons.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
