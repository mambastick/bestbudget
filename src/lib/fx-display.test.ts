import { describe, expect, it } from "vitest"
import { balanceValuation, formatExchangeRate, formatQuotedRate, formatRateSource } from "./fx-display"
import type { ExchangeRate } from "./exchange-rates"

const rates: ExchangeRate[] = [
  { currency: "USD", date: "2026-10-20", source: "cbr", rateToRub: "95" },
  { currency: "EUR", date: "2026-10-20", source: "cbr", rateToRub: "102.6" },
  { currency: "USD", date: "2026-09-13", source: "cbr", rateToRub: "90" },
]

describe("transfer rate labels", () => {
  it("prices foreign currencies in rubles in either transfer direction", () => {
    expect(formatExchangeRate(9500_00, 100_00, "RUB", "USD")).toBe("1 USD = 95,00 ₽")
    expect(formatExchangeRate(100_00, 9500_00, "USD", "RUB")).toBe("1 USD = 95,00 ₽")
    expect(formatExchangeRate(100_00, 108_00, "EUR", "USD")).toBe("1 EUR = 1,08 USD")
  })
  it("respects zero/three-digit minor units and retains small cross rates", () => {
    expect(formatExchangeRate(100, 60_00, "JPY", "RUB")).toBe("1 JPY = 0,60 ₽")
    expect(formatExchangeRate(1_000, 250_00, "BHD", "RUB")).toBe("1 BHD = 250,00 ₽")
    expect(formatExchangeRate(1000_00, 1_00, "USD", "EUR")).toBe("1 USD = 0,001 EUR")
    expect(formatExchangeRate(0, 100, "RUB", "USD")).toBeNull()
  })
  it("keeps exact provider quotes separate from rounded or edited transfer amounts", () => {
    expect(formatQuotedRate(rates.slice(0, 2), "RUB", "USD")).toBe("1 USD = 95,00 ₽")
    expect(formatQuotedRate(rates.slice(0, 2), "EUR", "USD")).toBe("1 EUR = 1,08 USD")
    expect(formatQuotedRate([], "RUB", "USD")).toBeNull()
    expect(formatRateSource(rates.slice(0, 2))).toBe("курс ЦБ на 20 октября")
    expect(formatRateSource([{ ...rates[0]!, source: "manual" }])).toBe("ручной курс на 20 октября")
    expect(formatRateSource([rates[0]!, { ...rates[1]!, date: "2026-10-19", source: "manual" }])).toBe("USD: курс ЦБ на 20 октября · EUR: ручной курс на 19 октября")
  })
})

describe("current balance valuation", () => {
  it("ignores historical quotes and deduplicates stale warnings by currency", () => {
    expect(balanceValuation(rates, ["USD", "USD", "EUR"], "RUB", "2026-10-27")).toEqual({
      note: "Включая 3 валютных счёта · оценка на 20 октября 2026", stale: [],
    })
    expect(balanceValuation(rates, ["USD", "USD", "EUR"], "RUB", "2026-10-28").stale).toEqual([
      "USD: курс от 20 октября (ЦБ)", "EUR: курс от 20 октября (ЦБ)",
    ])
  })
  it("uses the latest manual priority and includes a foreign base currency", () => {
    const manual = { ...rates[0]!, source: "manual" as const, date: "2026-10-21" }
    expect(balanceValuation([...rates, manual], ["RUB", "USD"], "EUR", "2026-10-29").stale).toEqual([
      "USD: курс от 21 октября (ручной)", "EUR: курс от 20 октября (ЦБ)",
    ])
    expect(balanceValuation([], [], "RUB", "2026-10-29")).toEqual({ note: null, stale: [] })
  })
})


describe("English FX labels", () => {
  it("uses decimal dots and English rate provenance", () => {
    expect(formatExchangeRate(9500_00, 100_00, "RUB", "USD", "en")).toBe("1 USD = 95.00 ₽")
    expect(formatQuotedRate(rates, "EUR", "USD", "en")).toBe("1 EUR = 1.08 USD")
    expect(formatRateSource(rates.slice(0, 2), "en")).toBe("CBR rate on October 20")
    expect(balanceValuation(rates, ["USD"], "RUB", "2026-10-28", "en")).toEqual({
      note: "Includes 1 foreign-currency account · valued as of October 20, 2026",
      stale: ["USD: rate from October 20 (CBR)"],
    })
  })
})
