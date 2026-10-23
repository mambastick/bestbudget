import { addDays, addMonths, daysInMonth, diffDays, makeDate, startOfMonth, ymd } from "@/lib/dates"
import { occurrencesBetween } from "./recurrence"
import { divideRounded } from "@/lib/exchange-rates"

export function safeMoney(value: bigint): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error("Money amount exceeds safe integer range")
  return n
}

export function sumMoney(values: readonly number[]): number {
  return safeMoney(values.reduce((sum, n) => sum + BigInt(n), 0n))
}

/** Complete calendar months, including months with no expenses. */
export function emergencyTarget(
  expenses: readonly { date: string; amount: number }[],
  today: string,
  window: 3 | 6,
  months: number,
): number {
  const end = startOfMonth(today)
  const start = addMonths(end, -window)
  const total = expenses.filter((r) => r.date >= start && r.date < end).reduce((sum, r) => sum + BigInt(r.amount), 0n)
  return safeMoney(divideRounded(total * BigInt(months), BigInt(window)))
}

export interface Allocation {
  id: string
  accountId: string
  priority: number
  sortOrder: number
  /** Ceiling already converted to account minor units. Null blocks lower priorities when rates are missing. */
  cap: number | null
}

/** Stable waterfall. Never allocates a minor unit twice, even after withdrawals. */
export function allocateGoals(goals: readonly Allocation[], balances: ReadonlyMap<string, number>): Map<string, number> {
  const remaining = new Map(balances)
  const result = new Map<string, number>()
  for (const g of [...goals].sort(
    (a, b) => a.priority - b.priority || a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )) {
    const available = Math.max(0, remaining.get(g.accountId) ?? 0)
    const allocated = g.cap === null ? 0 : Math.min(available, Math.max(0, g.cap))
    result.set(g.id, allocated)
    remaining.set(g.accountId, g.cap === null ? 0 : available - allocated)
  }
  return result
}

export function goalMetrics(input: {
  target: number
  progress: number
  today: string
  targetDate: string | null
  monthlyPace: number
  plannedDate?: string | null
}) {
  const remaining = Math.max(0, sumMoney([input.target, -input.progress]))
  const achieved = input.target > 0 && remaining === 0
  const days = input.targetDate ? diffDays(input.targetDate, input.today) : null
  // Use the actual length of the next three calendar months, with integer rounding up.
  const paceDays = diffDays(addMonths(input.today, 3), input.today)
  const monthlyRequired =
    days === null
      ? null
      : days <= 0
        ? remaining
        : safeMoney((BigInt(remaining) * BigInt(paceDays) + BigInt(days * 3 - 1)) / BigInt(days * 3))
  const duration =
    input.monthlyPace > 0
      ? (BigInt(remaining) * BigInt(paceDays) + (BigInt(input.monthlyPace) * 3n - 1n)) / (BigInt(input.monthlyPace) * 3n)
      : null
  const historicalDate = achieved ? input.today : duration !== null && duration <= 36500n ? addDays(input.today, Number(duration)) : null
  const forecastDate = achieved ? input.today : input.plannedDate === undefined ? historicalDate : input.plannedDate
  const status: "achieved" | "no_deadline" | "behind" | "on_track" = achieved
    ? "achieved"
    : !input.targetDate
      ? "no_deadline"
      : days! <= 0 || !forecastDate || forecastDate > input.targetDate
        ? "behind"
        : "on_track"
  return {
    remaining,
    percent: input.target > 0 ? Math.max(0, Math.min(100, Number((BigInt(input.progress) * 100n) / BigInt(input.target)))) : 0,
    monthlyRequired,
    historicalDate,
    forecastDate,
    status,
  }
}

export const GOAL_STATUS_LABELS = {
  achieved: "status.achieved",
  no_deadline: "status.no_deadline",
  behind: "status.behind",
  on_track: "status.on_track",
} as const

/** Shares the recurrence engine's clamping and slot count with the funding form. */
export function automaticGoalSchedule(today: string, targetDate: string, day: number, fundingGap: number) {
  if (!Number.isInteger(day) || day < 1 || day > 31 || fundingGap <= 0 || targetDate < today) return null
  let { y, m } = ymd(today)
  let startDate = makeDate(y, m, Math.min(day, daysInMonth(y, m)))
  if (startDate < today) {
    ;({ y, m } = ymd(addMonths(startOfMonth(today), 1)))
    startDate = makeDate(y, m, Math.min(day, daysInMonth(y, m)))
  }
  const count = occurrencesBetween(
    { frequency: "monthly", interval: 1, startDate, endDate: targetDate, dayOfMonth: day },
    startDate,
    targetDate,
  ).length
  if (!count) return null
  return { startDate, count, amount: safeMoney((BigInt(fundingGap) + BigInt(count - 1)) / BigInt(count)) }
}
