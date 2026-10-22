import { describe, expect, it } from "vitest"
import { accountDeltas, projectDailyBalances, signedAmount, sumPlanned, type FlowItem } from "./forecast"

const item = (date: string, type: FlowItem["type"], status: FlowItem["status"], amount: number): FlowItem => ({
  date,
  type,
  status,
  amount,
})

describe("signedAmount", () => {
  it("does not count transfers as income or expense", () => {
    expect(signedAmount({ type: "income", amount: 100 })).toBe(100)
    expect(signedAmount({ type: "expense", amount: 100 })).toBe(-100)
    expect(signedAmount({ type: "transfer", amount: 100 })).toBe(0)
  })
})

describe("accountDeltas", () => {
  it("moves money between accounts without creating it", () => {
    const deltas = accountDeltas({ type: "transfer", amount: 500, accountId: "a", toAccountId: "b" })
    expect(deltas).toEqual([
      ["a", -500],
      ["b", 500],
    ])
    expect(deltas.reduce((s, [, d]) => s + d, 0)).toBe(0)
  })
})

describe("projectDailyBalances", () => {
  const today = "2026-11-10"

  it("planned salary affects the forecast only from its date, never the past", () => {
    const days = projectDailyBalances(100_000, "2026-11-01", "2026-11-30", today, [
      item("2026-11-03", "expense", "posted", 10_000),
      item("2026-11-20", "income", "planned", 200_000),
      item("2026-11-15", "expense", "planned", 43_000),
    ])
    const at = (d: string) => days.find((x) => x.date === d)!.balance
    expect(at("2026-11-02")).toBe(100_000)
    expect(at("2026-11-03")).toBe(90_000)
    expect(at("2026-11-14")).toBe(90_000)
    expect(at("2026-11-15")).toBe(47_000)
    expect(at("2026-11-20")).toBe(247_000)
    expect(at("2026-11-30")).toBe(247_000)
  })

  it("projects overdue planned items onto today", () => {
    const days = projectDailyBalances(0, "2026-11-01", "2026-11-30", today, [item("2026-11-05", "income", "planned", 5_000)])
    expect(days.find((d) => d.date === "2026-11-05")!.balance).toBe(0)
    expect(days.find((d) => d.date === today)!.balance).toBe(5_000)
  })

  it("reveals cash gaps as negative projected days", () => {
    const days = projectDailyBalances(30_000, "2026-11-01", "2026-11-30", today, [
      item("2026-11-15", "expense", "planned", 43_000),
      item("2026-11-20", "income", "planned", 128_000),
    ])
    const negative = days.filter((d) => d.balance < 0).map((d) => d.date)
    expect(negative[0]).toBe("2026-11-15")
    expect(negative.at(-1)).toBe("2026-11-19")
  })

  it("ignores transfers in the total", () => {
    const days = projectDailyBalances(1_000, "2026-11-01", "2026-11-02", today, [item("2026-11-01", "transfer", "posted", 900)])
    expect(days.map((d) => d.balance)).toEqual([1_000, 1_000])
  })
})

describe("sumPlanned", () => {
  it("separates planned from actual amounts", () => {
    const items = [
      item("2026-11-05", "income", "posted", 238_000),
      item("2026-11-20", "income", "planned", 128_000),
      item("2026-11-07", "expense", "planned", 43_000),
      item("2026-12-07", "expense", "planned", 43_000),
    ]
    expect(sumPlanned(items, "2026-11-01", "2026-11-30")).toEqual({ income: 128_000, expense: 43_000 })
  })
})
