import type { MetadataRoute } from "next"
import { getLocale, getTranslations } from "next-intl/server"

export const dynamic = "force-dynamic"

/** Web app manifest: lets people install BestBudget on a phone's home screen. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("common")
  const locale = await getLocale()
  return {
    name: t("appName"),
    short_name: "BestBudget",
    description: t("appDescription"),
    lang: locale,
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
