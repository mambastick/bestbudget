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
  it("preserves literal quote prefixes for unambiguous own-export round trips", () => {
    expect(toCsv([["'=formula", "''@text"]])).toBe("\ufeff''=formula;'''@text\r\n")
  })
})


describe("English CSV", () => {
  it("uses commas between fields and dots in exact signed amounts", () => {
    expect(toCsv([[csvAmount(-150_050, "RUB", "en"), "RUB"], [csvAmount(1234, "BHD", "en"), "BHD"], [csvAmount(1234, "JPY", "en"), "JPY"]], "en"))
      .toBe("\ufeff-1500.50,RUB\r\n1.234,BHD\r\n1234,JPY\r\n")
  })
  it("quotes English delimiters and multiline data while escaping formulas", () => {
    expect(toCsv([['Cafe, "Demo"', "=1+1", "-cmd", "line\nnext", null]], "en"))
      .toBe('\ufeff"Cafe, ""Demo""",\'=1+1,\'-cmd,"line\nnext",\r\n')
  })
})
