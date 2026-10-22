import { describe, expect, it } from "vitest"
import { parseMoney } from "@/lib/money"
import { formatMoneyInput } from "./money-input"

describe("formatMoneyInput", () => {
  const plain = (s: string) => formatMoneyInput(s).replace(/\u2009/g, " ")

  it("groups thousands while typing", () => {
    expect(plain("7678666")).toBe("7 678 666")
    expect(plain("1000")).toBe("1 000")
    expect(plain("999")).toBe("999")
    expect(plain("1234567,5")).toBe("1 234 567,5")
  })

  it("normalizes separators and limits decimals", () => {
    expect(plain("12.345")).toBe("12,34")
    expect(plain("1 000,999")).toBe("1 000,99")
    expect(plain(",5")).toBe("0,5")
    expect(plain("007")).toBe("7")
    expect(plain("abc12")).toBe("12")
  })

  it("stays parseable", () => {
    expect(parseMoney(formatMoneyInput("7678666"))).toBe(767_866_600)
    expect(parseMoney(formatMoneyInput("1234,56"))).toBe(123_456)
  })
})
