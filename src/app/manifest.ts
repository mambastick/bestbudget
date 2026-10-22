import type { MetadataRoute } from "next"

/** Web app manifest: lets people install BestBudget on a phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BestBudget — семейный бюджет",
    short_name: "BestBudget",
    description: "Доходы, расходы, регулярные платежи и прогноз остатка для всей семьи",
    lang: "ru",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#16181d",
    theme_color: "#3b5bdb",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
