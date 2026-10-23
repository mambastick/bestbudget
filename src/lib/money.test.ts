import { describe, expect, it } from "vitest"
import { formatMoney, formatMoneyCompact, formatMoneyShort, minorToInput, parseMoney } from "./money"
import { currencySymbol } from "./currencies"
import { addMonths, todayIn } from "./dates"

describe("parseMoney", () => {
  it("parses common Russian input formats into kopecks", () => {
    expect(parseMoney("150000")).toBe(15_000_000)
    expect(parseMoney("1 234,5")).toBe(123_450)
    expect(parseMoney("1234.56")).toBe(123_456)
    expect(parseMoney("0,99 ₽")).toBe(99)
  })

  it("rejects invalid amounts", () => {
    expect(parseMoney("")).toBeNull()
    expect(parseMoney("-5")).toBeNull()
    expect(parseMoney("1,234")).toBeNull()
    expect(parseMoney("abc")).toBeNull()
  })

  it("round-trips through the input format without float errors", () => {
    for (const minor of [0, 1, 10, 99, 100, 123_456, 1_999_999_99]) {
      expect(parseMoney(minorToInput(minor))).toBe(minor)
    }
  })
})

describe("formatMoney", () => {
  it("formats rubles with Russian grouping and hides zero kopecks", () => {
    expect(formatMoney(23_800_000).replace(/\s/g, " ")).toBe("238 000 ₽")
    expect(formatMoney(-4_300_050).replace(/\s/g, " ")).toBe("−43 000,50 ₽")
    expect(formatMoney(500, "RUB", { sign: true }).replace(/\s/g, " ")).toBe("+5 ₽")
  })
})

describe("formatMoneyShort", () => {
  it("fits calendar cells", () => {
    expect(formatMoneyShort(95_000)).toBe("950")
    expect(formatMoneyShort(1_250_000)).toBe("12,5к")
    expect(formatMoneyShort(23_800_000)).toBe("238к")
    expect(formatMoneyShort(-120_000_000)).toBe("−1,2М")
  })
})

describe("dates", () => {
  it("clamps month arithmetic", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15")
  })

  it("computes today in the household time zone", () => {
    // 22:30 UTC on Nov 4 is already Nov 5 in Moscow.
    expect(todayIn("Europe/Moscow", new Date("2026-11-04T22:30:00Z"))).toBe("2026-11-05")
    expect(todayIn("UTC", new Date("2026-11-04T22:30:00Z"))).toBe("2026-11-04")
  })
})

describe("currency exponents", () => {
  it("parses and formats JPY without fractional minor units", () => {
    expect(parseMoney("1 234", "JPY")).toBe(1234)
    expect(parseMoney("1234,5", "JPY")).toBeNull()
    expect(minorToInput(1234, "JPY")).toBe("1234")
    expect(formatMoney(1234, "JPY")).toContain("1\u00a0234")
    expect(formatMoney(1234, "JPY")).not.toContain(",")
  })
  it("keeps cents and ISO three-digit fractions", () => {
    expect(parseMoney("1234,56", "USD")).toBe(123456)
    expect(minorToInput(123456, "USD")).toBe("1234,56")
    expect(formatMoney(123456, "USD")).toContain("234,56")
    expect(parseMoney("1,234", "BHD")).toBe(1234)
    expect(minorToInput(1234, "BHD")).toBe("1,234")
  })
})

describe("narrow currency symbols", () => {
  const plain = (value: string) => value.replace(/\s/g, " ")

  it.each([
    ["RUB", 471_182_774, "4 711 827,74 ₽", "₽4,711,827.74", "₽"],
    ["USD", 10_001, "100,01 $", "$100.01", "$"],
    ["EUR", 5_001, "50,01 €", "€50.01", "€"],
    ["JPY", 100, "100 ¥", "¥100", "¥"],
    ["CNY", 10_001, "100,01 ¥", "¥100.01", "¥"],
  ] as const)("formats %s amounts and input suffixes in both locales", (currency, minor, ru, en, symbol) => {
    expect(plain(formatMoney(minor, currency, { locale: "ru" }))).toBe(ru)
    expect(plain(formatMoney(minor, currency, { locale: "en" }))).toBe(en)
    expect(currencySymbol(currency, "ru")).toBe(symbol)
    expect(currencySymbol(currency, "en")).toBe(symbol)
  })

  it("keeps whole-amount precision and signs unchanged", () => {
    expect(plain(formatMoney(10_000, "USD", { locale: "ru" }))).toBe("100 $")
    expect(formatMoney(10_000, "USD", { locale: "en" })).toBe("$100")
    expect(formatMoney(5_000, "EUR", { locale: "en" })).toBe("€50")
    expect(formatMoney(-471_182_774, "RUB", { locale: "en" })).toBe("−₽4,711,827.74")
    expect(formatMoney(471_182_774, "RUB", { locale: "en", sign: true })).toBe("+₽4,711,827.74")
  })

  it("preserves number-only chart and calendar abbreviations", () => {
    expect(formatMoneyCompact(600_000_000, "RUB", "en")).toBe("6M")
    expect(formatMoneyCompact(450_000_000, "RUB", "en")).toBe("4.5M")
    expect(plain(formatMoneyCompact(450_000_000, "RUB", "ru"))).toBe("4,5 млн")
    expect(formatMoneyShort(1_250_000, "USD", "en")).toBe("12.5K")
    expect(formatMoneyShort(1_250_000, "USD", "ru")).toBe("12,5к")
  })
})
