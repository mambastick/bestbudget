import { ImageResponse } from "next/og"
import { BrandIconImage } from "@/components/app/brand-icon"
import { PWA_COLORS, SPLASH_SCREENS } from "@/lib/pwa/splash"

/** Strict size allowlist prevents arbitrary, memory-expensive image rendering. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const width = Number(params.get("width"))
  const height = Number(params.get("height"))
  const theme = params.get("theme")
  const valid = SPLASH_SCREENS.some(([w, h, scale]) =>
    (width === w * scale && height === h * scale) || (width === h * scale && height === w * scale))
  if (!valid || (theme !== "light" && theme !== "dark")) return new Response(null, { status: 400 })
  const size = Math.round(Math.min(width, height) * 0.18)
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: PWA_COLORS[theme] }}>
      <BrandIconImage size={size} />
    </div>,
    { width, height, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  )
}
