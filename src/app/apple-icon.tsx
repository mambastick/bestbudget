import { ImageResponse } from "next/og"
import { BrandIconImage } from "@/components/app/brand-icon"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

/** Home-screen icon for iOS. */
export default function AppleIcon() {
  return new ImageResponse(<BrandIconImage size={180} padded />, size)
}
