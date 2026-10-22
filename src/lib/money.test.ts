import { describe, expect, it } from "vitest"
import { formatMoney, minorToInput, parseMoney } from "./money"
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
