import { PWA_COLORS } from "@/lib/pwa/splash"
import type { MetadataRoute } from "next"
import { getLocale, getTranslations } from "next-intl/server"

export const dynamic = "force-dynamic"

/** Web app manifest: lets people install BestBudget on a phone's home screen. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("common")
  const locale = await getLocale()
  const pwa = await getTranslations("pwa")
  return {
    name: t("appName"),
    short_name: "BestBudget",
    description: t("appDescription"),
    lang: locale,
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "any",
    categories: ["finance"],
    background_color: PWA_COLORS.light,
    theme_color: PWA_COLORS.light,
    shortcuts: [
      { name: pwa("shortcuts.transaction"), url: "/dashboard?new=transaction", icons: [{ src: "/pwa-icon/192", sizes: "192x192", type: "image/png" }] },
      { name: pwa("shortcuts.calendar"), url: "/calendar", icons: [{ src: "/pwa-icon/192", sizes: "192x192", type: "image/png" }] },
      { name: pwa("shortcuts.import"), url: "/transactions/import", icons: [{ src: "/pwa-icon/192", sizes: "192x192", type: "image/png" }] },
    ],
    screenshots: [
      { src: "/screenshots/dashboard-narrow.png", sizes: "750x1624", type: "image/png", form_factor: "narrow", label: pwa("screenshots.narrow") },
      { src: "/screenshots/dashboard-wide.png", sizes: "1280x800", type: "image/png", form_factor: "wide", label: pwa("screenshots.wide") },
    ],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
