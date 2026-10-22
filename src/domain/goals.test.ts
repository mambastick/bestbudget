import { describe, expect, it } from "vitest"
import { convertMinor } from "@/lib/exchange-rates"
import { allocateGoals, automaticGoalSchedule, emergencyTarget, goalMetrics, sumMoney } from "./goals"

const base = { today: "2026-01-01", target: 300_000_00, progress: 0, targetDate: "2026-07-01", monthlyPace: 50_000_00 }

describe("goal calculations", () => {
  it("handles no deadline, past deadline, zero pace and overfunding", () => {
    expect(goalMetrics({ ...base, targetDate: null })).toMatchObject({ status: "no_deadline", monthlyRequired: null })
    expect(goalMetrics({ ...base, targetDate: "2025-12-31" })).toMatchObject({ status: "behind", monthlyRequired: base.target })
    expect(goalMetrics({ ...base, monthlyPace: 0 })).toMatchObject({ forecastDate: null, status: "behind" })
    expect(goalMetrics({ ...base, progress: 350_000_00 })).toMatchObject({
      remaining: 0,
      percent: 100,
      status: "achieved",
      monthlyRequired: 0,
    })
    expect(goalMetrics({ ...base, progress: -100_00 }).remaining).toBe(300_100_00)
    expect(goalMetrics({ ...base, target: 0, progress: 0 }).status).not.toBe("achieved")
  })
  it("uses integer minor units and keeps schedule and historical scenarios separate", () => {
    expect(goalMetrics(base)).toMatchObject({ status: "on_track", historicalDate: "2026-06-30", monthlyRequired: 4_972_376 })
    expect(goalMetrics({ ...base, monthlyPace: 0, plannedDate: "2026-06-05" })).toMatchObject({
      status: "on_track",
      historicalDate: null,
      forecastDate: "2026-06-05",
    })
    expect(() => sumMoney([Number.MAX_SAFE_INTEGER, 1])).toThrow("safe integer")
  })
  it("converts RUB account progress into a USD target without floating money", () => {
    const progress = convertMinor(750_000_00, "RUB", "USD", "1", "100")
    expect(goalMetrics({ ...base, target: 15_000_00, progress })).toMatchObject({ percent: 50, remaining: 7_500_00 })
    expect(convertMinor(10000, "JPY", "USD", "0.65", "100")).toBe(6500)
  })
  it("calculates the emergency fund from 3/6 complete months, including zero months", () => {
    const expenses = [
      { date: "2026-07-15", amount: 30_000_00 },
      { date: "2026-08-01", amount: 60_000_00 },
      { date: "2026-10-01", amount: 999_000_00 },
      { date: "2026-03-01", amount: 999_000_00 },
    ]
    expect(emergencyTarget(expenses, "2026-10-23", 3, 6)).toBe(180_000_00)
    expect(emergencyTarget(expenses, "2026-10-23", 6, 6)).toBe(90_000_00)
    expect(emergencyTarget([], "2026-10-23", 3, 6)).toBe(0)
  })
  it("counts real monthly slots and clamps month ends without drift", () => {
    expect(automaticGoalSchedule("2026-01-31", "2026-03-31", 31, 100)).toEqual({ startDate: "2026-01-31", count: 3, amount: 34 })
    expect(automaticGoalSchedule("2026-02-28", "2026-03-31", 31, 100)).toEqual({ startDate: "2026-02-28", count: 2, amount: 50 })
    expect(automaticGoalSchedule("2026-01-20", "2026-02-01", 5, 100)).toBeNull()
    expect(goalMetrics({ ...base, plannedDate: null }).status).toBe("behind")
  })
  it("allocates deterministically, caps allocations and recalculates withdrawals", () => {
    const goals = [
      { id: "b", accountId: "s", priority: 2, sortOrder: 0, cap: 100 },
      { id: "a", accountId: "s", priority: 1, sortOrder: 0, cap: 60 },
    ]
    expect([...allocateGoals(goals, new Map([["s", 100]]))]).toEqual([
      ["a", 60],
      ["b", 40],
    ])
    expect([...allocateGoals(goals, new Map([["s", 50]]))]).toEqual([
      ["a", 50],
      ["b", 0],
    ])
    expect([...allocateGoals(goals, new Map([["s", -10]]))].every(([, value]) => value === 0)).toBe(true)
    expect([...allocateGoals([{ ...goals[1]!, cap: null }, goals[0]!], new Map([["s", 100]]))]).toEqual([
      ["a", 0],
      ["b", 0],
    ])
  })
})
