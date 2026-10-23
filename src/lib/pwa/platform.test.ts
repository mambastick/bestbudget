import { describe, expect, it, vi } from "vitest"
import { installPlatform, isStandalone } from "./platform"

describe("PWA platform detection", () => {
  it.each([
    ["iPhone Version/17.0 Mobile Safari/604.1", "iPhone", 5, "iosSafari"],
    ["iPhone CriOS/120.0 Mobile Safari/604.1", "iPhone", 5, "iosOther"],
    ["Macintosh Version/17.0 Safari/604.1", "MacIntel", 5, "iosSafari"],
    ["Android Chrome/120", "Linux", 5, "browser"],
    ["Macintosh Chrome/120", "MacIntel", 0, "browser"],
  ])("detects instructions for %s", (userAgent, platform, maxTouchPoints, expected) => {
    vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints })
    try { expect(installPlatform()).toBe(expected) } finally { vi.unstubAllGlobals() }
  })

  it.each([[true, false], [false, true], [false, false]])("standalone media=%s, iOS=%s", (media, ios) => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: media }) })
    vi.stubGlobal("navigator", { standalone: ios })
    try { expect(isStandalone()).toBe(media || ios) } finally { vi.unstubAllGlobals() }
  })
})
