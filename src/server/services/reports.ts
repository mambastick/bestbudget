import "server-only"
import { and, eq, gte, lt, lte, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { categories, financialAccounts, transactions } from "@/db/schema"
import { effectiveDate, projectDailyBalances, signedAmount, type FlowItem } from "@/domain/forecast"
import { addDays, addMonths, diffDays, endOfMonth, maxDate, monthKey, startOfMonth, todayIn, type IsoDate } from "@/lib/dates"
import { assertCan, type HouseholdCtx } from "../context"
import { ensureMaterialized, virtualOccurrences, type VirtualOccurrence } from "./recurring"
import { listInRange, type TransactionRow } from "./transactions"

const signedSql = sql<string>`coalesce(sum(case
  when ${transactions.type} = 'income' then ${transactions.amount}
  when ${transactions.type} = 'expense' then -${transactions.amount}
  else 0 end), 0)`

async function openingTotal(ctx: HouseholdCtx) {
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${financialAccounts.openingBalance}), 0)` })
    .from(financialAccounts)
    .where(eq(financialAccounts.householdId, ctx.householdId))
  return Number(row?.total ?? 0)
}

/** Current actual balance: opening balances of all accounts plus every posted operation. */
export async function actualBalance(ctx: HouseholdCtx) {
  const [row] = await getDb()
    .select({ total: signedSql })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "posted")))
  return (await openingTotal(ctx)) + Number(row?.total ?? 0)
}

async function postedSignedBefore(ctx: HouseholdCtx, date: IsoDate) {
  const [row] = await getDb()
    .select({ total: signedSql })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "posted"), lt(transactions.date, date)))
  return Number(row?.total ?? 0)
}

async function plannedRowsUntil(ctx: HouseholdCtx, to: IsoDate) {
  return getDb()
    .select({ date: transactions.date, type: transactions.type, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "planned"), lte(transactions.date, to)))
}

async function postedRowsBetween(ctx: HouseholdCtx, from: IsoDate, to: IsoDate) {
  return getDb()
    .select({ date: transactions.date, type: transactions.type, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "posted"), gte(transactions.date, from), lte(transactions.date, to)))
}

/**
 * Daily projected balance for [from, to].
 * Past days use posted operations only; from today on, planned (materialized and virtual) operations are added.
 */
export async function projection(ctx: HouseholdCtx, from: IsoDate, to: IsoDate, today: IsoDate) {
  const [opening, postedBefore, planned, posted, virtual] = await Promise.all([
    openingTotal(ctx),
    postedSignedBefore(ctx, from),
    plannedRowsUntil(ctx, to),
    postedRowsBetween(ctx, from, to),
    to >= today ? virtualOccurrences(ctx, today, to, today) : Promise.resolve([] as VirtualOccurrence[]),
  ])
  const plannedItems: FlowItem[] = [
    ...planned.map((p) => ({ ...p, status: "planned" as const })),
    ...virtual.map((v) => ({ date: v.date, type: v.type, amount: v.amount, status: "planned" as const })),
  ]
  let base = opening + postedBefore
  for (const p of plannedItems) if (effectiveDate(p, today) < from) base += signedAmount(p)
  const items: FlowItem[] = [...posted.map((p) => ({ ...p, status: "posted" as const })), ...plannedItems]
  return { days: projectDailyBalances(base, from, to, today, items), plannedItems, virtual }
}

export interface UpcomingItem {
  key: string
  id: string | null
  ruleId: string | null
  date: IsoDate
  type: "income" | "expense" | "transfer"
  amount: number
  title: string
  categoryIcon: string | null
  categoryColor: string | null
  overdue: boolean
}

export async function getDashboard(ctx: HouseholdCtx, month: IsoDate) {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone)
  await ensureMaterialized(ctx.householdId, today)
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const db = getDb()

  const sixStart = addMonths(monthStart, -5)
  const forecastEnd = addDays(today, 90)

  const [balance, monthProjection, trend, byCategory, forecast, upcomingRows, upcomingVirtual] = await Promise.all([
    actualBalance(ctx),
    projection(ctx, monthStart, monthEnd, today),
    db
      .select({
        month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
        expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense'), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "posted"), gte(transactions.date, sixStart), lte(transactions.date, monthEnd)))
      .groupBy(sql`1`),
    expenseByCategory(ctx, monthStart, monthEnd),
    projection(ctx, today, forecastEnd, today),
    listInRange(ctx, today, addDays(today, 31), { overdueBefore: today }),
    virtualOccurrences(ctx, today, addDays(today, 31), today),
  ])

  const monthRows = await getDb()
    .select({
      status: transactions.status,
      income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense'), 0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), gte(transactions.date, monthStart), lte(transactions.date, monthEnd)))
    .groupBy(transactions.status)
  const sumOf = (status: string, key: "income" | "expense") => Number(monthRows.find((r) => r.status === status)?.[key] ?? 0)

  let plannedIncome = sumOf("planned", "income")
  let plannedExpense = sumOf("planned", "expense")
  for (const v of monthProjection.virtual) {
    if (v.date < monthStart || v.date > monthEnd) continue
    if (v.type === "income") plannedIncome += v.amount
    if (v.type === "expense") plannedExpense += v.amount
  }

  // Money that stays free after all planned expenses up to the end of the (current or selected future) month,
  // without relying on income that has not arrived yet.
  const obligationsUntil = maxDate(monthEnd, endOfMonth(today))
  const obligationSource =
    obligationsUntil === monthEnd ? monthProjection.plannedItems : (await projection(ctx, today, obligationsUntil, today)).plannedItems
  const plannedObligations = obligationSource
    .filter((p) => p.type === "expense" && p.date <= obligationsUntil)
    .reduce((s, p) => s + p.amount, 0)

  const categoryLook = new Map(
    (await db.select({ id: categories.id, icon: categories.icon, color: categories.color }).from(categories).where(eq(categories.householdId, ctx.householdId))).map(
      (c) => [c.id, c],
    ),
  )
  const trendMap = new Map(trend.map((t) => [t.month, t]))
  const trendSeries = Array.from({ length: 6 }, (_, i) => {
    const key = monthKey(addMonths(sixStart, i))
    const t = trendMap.get(key)
    return { month: key, income: Number(t?.income ?? 0), expense: Number(t?.expense ?? 0) }
  })

  const upcoming: UpcomingItem[] = [
    ...upcomingRows
      .filter((r) => r.status === "planned")
      .map((r) => ({
        key: r.id,
        id: r.id,
        ruleId: r.recurringRuleId,
        date: r.date,
        type: r.type,
        amount: r.amount,
        title: r.title,
        categoryIcon: r.categoryIcon,
        categoryColor: r.categoryColor,
        overdue: r.date < today,
      })),
    ...upcomingVirtual.map((v) => {
      const c = v.categoryId ? categoryLook.get(v.categoryId) : undefined
      return {
        key: `${v.ruleId}:${v.date}`,
        id: null,
        ruleId: v.ruleId,
        date: v.date,
        type: v.type,
        amount: v.amount,
        title: v.title,
        categoryIcon: c?.icon ?? null,
        categoryColor: c?.color ?? null,
        overdue: false,
      }
    }),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10)

  const lastDay = monthProjection.days.at(-1)
  return {
    today,
    monthStart,
    balance,
    monthIncome: sumOf("posted", "income"),
    monthExpense: sumOf("posted", "expense"),
    plannedIncome,
    plannedExpense,
    forecastEndOfMonth: lastDay?.balance ?? balance,
    availableAfterObligations: balance - plannedObligations,
    obligationsUntil,
    monthDays: monthProjection.days,
    trend: trendSeries,
    byCategory,
    forecast: forecast.days,
    upcoming,
  }
}

export async function expenseByCategory(ctx: HouseholdCtx, from: IsoDate, to: IsoDate) {
  const rows = await getDb()
    .select({
      categoryId: transactions.categoryId,
      name: categories.name,
      color: categories.color,
      icon: categories.icon,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        eq(transactions.status, "posted"),
        eq(transactions.type, "expense"),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .groupBy(transactions.categoryId, categories.name, categories.color, categories.icon)
  return rows.map((r) => ({ ...r, total: Number(r.total) })).sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type CalendarItem = Pick<
  TransactionRow,
  "id" | "type" | "status" | "amount" | "title" | "date" | "categoryIcon" | "categoryColor" | "categoryName" | "accountName" | "toAccountName" | "authorName" | "recurringRuleId" | "version"
> & { virtual: boolean; key: string }

export async function getCalendarMonth(ctx: HouseholdCtx, month: IsoDate) {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone)
  await ensureMaterialized(ctx.householdId, today)
  const from = startOfMonth(month)
  const to = endOfMonth(month)
  const inThisMonth = today >= from && today <= to
  const [proj, rows] = await Promise.all([
    projection(ctx, from, to, today),
    listInRange(ctx, from, to, inThisMonth ? { overdueBefore: from } : {}),
  ])
  const catRows = await getDb()
    .select({ id: categories.id, name: categories.name, icon: categories.icon, color: categories.color })
    .from(categories)
    .where(eq(categories.householdId, ctx.householdId))
  const cats = new Map(catRows.map((c) => [c.id, c]))

  const items: CalendarItem[] = [
    ...rows.map((r) => ({ ...r, virtual: false, key: r.id })),
    ...proj.virtual
      .filter((v) => v.date >= from && v.date <= to)
      .map((v) => {
        const c = v.categoryId ? cats.get(v.categoryId) : undefined
        return {
          id: "",
          key: `${v.ruleId}:${v.date}`,
          virtual: true,
          type: v.type,
          status: "planned" as const,
          amount: v.amount,
          title: v.title,
          date: v.date,
          categoryIcon: c?.icon ?? null,
          categoryColor: c?.color ?? null,
          categoryName: c?.name ?? null,
          accountName: "",
          toAccountName: null,
          authorName: null,
          recurringRuleId: v.ruleId,
          version: 0,
        }
      }),
  ]
  return { today, from, to, days: proj.days, items }
}

// ---------------------------------------------------------------------------
// Analytics (actual data; forecast is separate)
// ---------------------------------------------------------------------------

async function totals(ctx: HouseholdCtx, from: IsoDate, to: IsoDate) {
  const [row] = await getDb()
    .select({
      income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense'), 0)`,
      count: sql<number>`count(*) filter (where ${transactions.type} <> 'transfer')::int`,
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "posted"), gte(transactions.date, from), lte(transactions.date, to)))
  const income = Number(row?.income ?? 0)
  const expense = Number(row?.expense ?? 0)
  return { income, expense, net: income - expense, count: row?.count ?? 0 }
}

export async function getAnalytics(ctx: HouseholdCtx, from: IsoDate, to: IsoDate) {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone)
  const length = diffDays(to, from) + 1
  const prevTo = addDays(from, -1)
  const prevFrom = addDays(prevTo, -(length - 1))

  const db = getDb()
  const [current, previous, categoriesTop, monthly, opening, postedBeforeFrom] = await Promise.all([
    totals(ctx, from, to),
    totals(ctx, prevFrom, prevTo),
    expenseByCategory(ctx, from, to),
    db
      .select({
        month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
        expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense'), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "posted"), gte(transactions.date, from), lte(transactions.date, to)))
      .groupBy(sql`1`),
    openingTotal(ctx),
    postedSignedBefore(ctx, from),
  ])

  const monthlyMap = new Map(monthly.map((m) => [m.month, m]))
  const series: { month: string; income: number; expense: number; net: number; balance: number }[] = []
  let balance = opening + postedBeforeFrom
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) {
    const key = monthKey(m)
    const row = monthlyMap.get(key)
    const income = Number(row?.income ?? 0)
    const expense = Number(row?.expense ?? 0)
    balance += income - expense
    series.push({ month: key, income, expense, net: income - expense, balance })
  }

  // Forecast is computed separately from actuals: projected end-of-month balance for the next 3 months.
  const forecastTo = endOfMonth(addMonths(today, 3))
  const proj = await projection(ctx, today, forecastTo, today)
  const forecast = [0, 1, 2, 3].map((i) => {
    const end = endOfMonth(addMonths(today, i))
    const day = proj.days.find((d) => d.date === end)
    return { month: monthKey(end), balance: day?.balance ?? 0 }
  })

  const change = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10)
  return {
    from,
    to,
    current,
    previous: { ...previous, from: prevFrom, to: prevTo },
    expenseChange: change(current.expense, previous.expense),
    incomeChange: change(current.income, previous.income),
    categories: categoriesTop,
    series,
    forecast,
  }
}
