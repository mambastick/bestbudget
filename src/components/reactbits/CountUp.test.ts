import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import CountUp from "./CountUp"

describe("CountUp decimal separator", () => {
  it.each(["count", "roll"] as const)("uses the requested separator in %s mode", (mode) => {
    const html = renderToStaticMarkup(createElement(CountUp, {
      to: 66115.12, from: 66115.12, decimals: 2, separator: " ", decimalSeparator: ",", suffix: " ₽", mode,
    }))
    expect(html).toContain("66 115,12 ₽")
    expect(html).not.toContain("66 115.12 ₽")
    if (mode === "roll") {
      expect(html).toContain(">,</span>")
      expect(html).not.toContain(">.</span>")
    }
  })

  it("keeps the vendor default for other callers", () => {
    const html = renderToStaticMarkup(createElement(CountUp, { to: 12.5, from: 12.5, decimals: 2 }))
    expect(html).toContain("12.50")
  })
})
