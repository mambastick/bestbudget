import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { convertMinor, parseCbrXml, rateUnits, selectRate, type ExchangeRate } from "./exchange-rates"

const fixture = readFileSync(new URL("../../tests/fixtures/cbr-daily.xml", import.meta.url))

describe("CBR daily XML", () => {
  it("parses decimal commas, unit rates and non-unit nominals in Windows-1251", () => {
    const rates = parseCbrXml(fixture)
    expect(rates).toContainEqual({ currency: "JPY", date: "2026-10-22", rateToRub: "0.6012340000", source: "cbr" })
    expect(rates).toContainEqual({ currency: "UZS", date: "2026-10-22", rateToRub: "0.0070123400", source: "cbr" })
    expect(rates.find((r) => r.currency === "USD")?.rateToRub).toBe("95.1234000000")
    // Cyrillic bytes in the document are accepted by the legacy decoder.
    expect(parseCbrXml(Buffer.concat([Buffer.from("<!-- "), Buffer.from([0xd0, 0xf3, 0xe1, 0xeb, 0xfc]), Buffer.from(" -->"), fixture]))).toEqual(rates)
  })
  it("accepts a real CBR response including scientific notation and Cyrillic names", () => {
    const real = readFileSync(new URL("../../tests/fixtures/cbr-daily-2026-10-22.xml", import.meta.url))
    const rates = parseCbrXml(real)
    expect(rates.length).toBeGreaterThan(30)
    expect(rates.find((r) => r.currency === "IRR")).toMatchObject({ date: "2026-10-22", rateToRub: "0.0000447935" })
    expect(rates.find((r) => r.currency === "JPY")?.date).toBe("2026-10-22")
  })
  it("rejects malformed, empty or nonpositive responses", () => {
    expect(() => parseCbrXml("<html>error</html>")).toThrow()
    expect(() => parseCbrXml(fixture.toString().replace("95,1234", "0,0000").replace("95,1234", "0,0000"))).toThrow()
    expect(() => parseCbrXml(fixture.toString().replace("22.10.2026", "31.02.2026"))).toThrow()
    expect(() => rateUnits("Infinity")).toThrow()
    expect(() => rateUnits("0")).toThrow()
  })
})

describe("integer conversion", () => {
  it("uses half-up, including negative ties, without binary-float errors", () => {
    expect(convertMinor(1, "USD", "RUB", "1.5", "1")).toBe(2)
    expect(convertMinor(-1, "USD", "RUB", "1.5", "1")).toBe(-2)
    expect(convertMinor(100_00, "USD", "RUB", "95.1234", "1")).toBe(951_234)
    expect(convertMinor(100_00, "USD", "EUR", "90", "100")).toBe(90_00)
    expect(convertMinor(100, "JPY", "USD", "0.6", "90")).toBe(67)
    expect(convertMinor(100_00, "USD", "JPY", "90", "0.6")).toBe(15000)
    expect(convertMinor(1000, "BHD", "USD", "240", "90")).toBe(267)
    expect(convertMinor(100, "RUB", "RUB", "1", "1")).toBe(100)
    expect(() => convertMinor(Number.MAX_SAFE_INTEGER, "USD", "RUB", "100", "1")).toThrow(/safe integer/)
  })
  it("selects latest <= date and manual priority only on an equal date", () => {
    const rates: ExchangeRate[] = [
      { currency: "USD", date: "2026-10-01", source: "cbr", rateToRub: "90" },
      { currency: "USD", date: "2026-10-01", source: "manual", rateToRub: "91" },
      { currency: "USD", date: "2026-10-05", source: "cbr", rateToRub: "92" },
    ]
    expect(selectRate(rates, "USD", "2026-10-04")?.rateToRub).toBe("91")
    expect(selectRate(rates, "USD", "2026-10-05")?.rateToRub).toBe("92")
    expect(selectRate(rates, "USD", "2026-09-30")).toBeNull()
    expect(selectRate(rates, "EUR", "2026-10-05")).toBeNull()
    expect(selectRate([], "RUB", "2026-10-05")?.rateToRub).toBe("1")
  })
})
