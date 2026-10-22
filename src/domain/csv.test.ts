import { describe, expect, it } from "vitest"
import { csvAmount, toCsv } from "./csv"

describe("toCsv", () => {
  it("uses semicolons, CRLF and a BOM", () => {
    expect(toCsv([["a", 1], ["b", null]])).toBe("\ufeffa;1\r\nb;\r\n")
  })

  it("quotes separators and neutralizes formulas", () => {
    expect(toCsv([['Кафе; "Ромашка"', "=HYPERLINK(1)", "-cmd", "+1"]])).toBe('\ufeff"Кафе; ""Ромашка""";\'=HYPERLINK(1);\'-cmd;\'+1\r\n')
  })

  it("keeps negative numbers numeric", () => {
    expect(toCsv([[csvAmount(-150_050)]])).toBe("\ufeff-1500,50\r\n")
    expect(csvAmount(-150_050)).toBe("-1500,50")
    expect(csvAmount(5)).toBe("0,05")
  })
})
