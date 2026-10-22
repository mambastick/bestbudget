import { ImageResponse } from "next/og"
import { BrandIconImage } from "@/components/app/brand-icon"

const SIZES = new Set([192, 512])

/** PNG icons for the web app manifest. `?maskable=1` adds the safe-zone padding Android expects. */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size)
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 })
  const maskable = new URL(request.url).searchParams.get("maskable") === "1"
  return new ImageResponse(<BrandIconImage size={size} padded={maskable} />, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=604800, immutable" },
  })
}
