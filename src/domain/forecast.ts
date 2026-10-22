import { addDays, maxDate, type IsoDate } from "@/lib/dates"

export type FlowType = "income" | "expense" | "transfer"
export type FlowStatus = "planned" | "posted"

export interface FlowItem {
  date: IsoDate
  type: FlowType
  status: FlowStatus
  amount: number
}

/**
 * Effect of an operation on the household's total balance.
 * Transfers between own accounts move money but do not change the total.
 */
export function signedAmount(item: Pick<FlowItem, "type" | "amount">): number {
  if (item.type === "income") return item.amount
  if (item.type === "expense") return -item.amount
  return 0
}

/**
 * Date on which an item affects the projected balance.
 * Planned items whose date already passed are still expected, so they are projected onto `today`.
 */
export function effectiveDate(item: Pick<FlowItem, "date" | "status">, today: IsoDate): IsoDate {
  return item.status === "planned" ? maxDate(item.date, today) : item.date
}

export interface DayBalance {
  date: IsoDate
  income: number
  expense: number
  /** Balance at the end of the day: actual for past days, projected from today on. */
  balance: number
}

/**
 * Projects the end-of-day balance for every day in [from, to].
 *
 * `base` is the balance at the end of the day before `from` (opening balances + everything
 * effective before `from`). Items outside [from, to] are ignored. Planned items never affect
 * days before `today`, because they had not happened.
 */
export function projectDailyBalances(base: number, from: IsoDate, to: IsoDate, today: IsoDate, items: FlowItem[]): DayBalance[] {
  const byDay = new Map<IsoDate, { income: number; expense: number; delta: number }>()
  for (const item of items) {
    const d = effectiveDate(item, today)
    if (d < from || d > to) continue
    const bucket = byDay.get(d) ?? { income: 0, expense: 0, delta: 0 }
    if (item.type === "income") bucket.income += item.amount
    if (item.type === "expense") bucket.expense += item.amount
    bucket.delta += signedAmount(item)
    byDay.set(d, bucket)
  }

  const out: DayBalance[] = []
  let balance = base
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const bucket = byDay.get(d)
    balance += bucket?.delta ?? 0
    out.push({ date: d, income: bucket?.income ?? 0, expense: bucket?.expense ?? 0, balance })
  }
  return out
}

/** Sum of planned income/expense items (by their own date) within [from, to]. */
export function sumPlanned(items: FlowItem[], from: IsoDate, to: IsoDate) {
  let income = 0
  let expense = 0
  for (const i of items) {
    if (i.status !== "planned" || i.date < from || i.date > to) continue
    if (i.type === "income") income += i.amount
    else if (i.type === "expense") expense += i.amount
  }
  return { income, expense }
}

/** Per-account balance delta of a posted operation. */
export function accountDeltas(item: { type: FlowType; amount: number; accountId: string; toAccountId: string | null }): Array<[string, number]> {
  switch (item.type) {
    case "income":
      return [[item.accountId, item.amount]]
    case "expense":
      return [[item.accountId, -item.amount]]
    case "transfer":
      return [
        [item.accountId, -item.amount],
        [item.toAccountId!, item.amount],
      ]
  }
}
