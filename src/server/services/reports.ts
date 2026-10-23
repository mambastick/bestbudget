import "server-only"
import { and, eq, isNotNull } from "drizzle-orm"
import { getDb } from "@/db"
import { categories, transactions } from "@/db/schema"
import { effectiveDate, type FlowItem } from "@/domain/forecast"
import { addDays, addMonths, diffDays, endOfMonth, maxDate, monthKey, startOfMonth, todayIn, type IsoDate } from "@/lib/dates"
import { balanceValuation } from "@/lib/fx-display"
import { assertCan, type HouseholdCtx } from "../context"
import { applyMovement, loadFinance, pastValuationDates, type FinanceData } from "./finance-data"
import { ensureMaterialized, virtualOccurrences, type VirtualOccurrence } from "./recurring"
import { ensureLoansMaterialized, virtualLoanPayments } from "./loans"
import { listInRange, loanDisplayCondition, transactionListQuery, type TransactionRow } from "./transactions"

/** Account balances are valued at the latest known rate, including archived accounts. */
export async function actualBalance(ctx: HouseholdCtx) {
  assertCan(ctx, "finance.read")
  return (await loadFinance(ctx)).balance
}

async function project(ctx: HouseholdCtx, data: FinanceData, from: IsoDate, to: IsoDate, today: IsoDate) {
  const regular = to >= today ? await virtualOccurrences(ctx, today, to, today) : [] as VirtualOccurrence[]
  const loanParts = to >= today ? await virtualLoanPayments(ctx, today, to) : []
  const loanVirtual = loanParts
  const virtual = [...regular, ...loanVirtual]
  const planned = [...data.rows.filter((r) => r.status === "planned" && r.date <= to), ...virtual.map((v) => ({ ...v, status: "planned" as const }))]
  const plannedItems: FlowItem[] = planned.map((r) => ({ date: r.date, type: r.type === "transfer" && data.accountMap.get(r.toAccountId ?? "")?.kind === "loan" ? "expense" : r.type, status: "planned", amount: data.value(r) }))
  const movements = [
    ...data.rows.filter((r) => r.status === "posted" && r.date <= to),
    ...planned.map((r) => ({ ...r, date: effectiveDate({ date: r.date, status: "planned" }, today) })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const balances = new Map(data.accounts.map((a) => [a.id, a.openingBalance]))
  let index = 0
  const days = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    let income = 0
    let expense = 0
    while (index < movements.length && movements[index]!.date <= date) {
      const row = movements[index++]!
      applyMovement(balances, row)
      if (row.date !== date) continue
      if (row.type === "income") income += data.value(row)
      if (row.type === "expense") expense += data.value(row)
    }
    const balance = data.accounts.filter((a) => a.kind !== "loan").reduce((sum, a) => sum + data.convert(balances.get(a.id)!, a.currency, date), 0)
    days.push({ date, income, expense, balance })
  }
  return { days, plannedItems, virtual }
}

export async function projection(ctx: HouseholdCtx, from: IsoDate, to: IsoDate, today: IsoDate) {
  assertCan(ctx, "finance.read")
  return project(ctx, await loadFinance(ctx, pastValuationDates(from, to, today)), from, to, today)
}

export interface UpcomingItem {
  key: string
  id: string | null
  ruleId: string | null
  loanId?: string | null
  loanPrincipal?: number
  loanInterest?: number
  date: IsoDate
  type: "income" | "expense" | "transfer"
  amount: number
  currency: string
  title: string
  categoryIcon: string | null
  categoryColor: string | null
  overdue: boolean
}

function totals(data: FinanceData, from: string, to: string, status = "posted") {
  let income = 0
  let expense = 0
  let count = 0
  for (const r of data.rows) {
    if (r.status !== status || r.date < from || r.date > to || r.type === "transfer") continue
    const amount = data.value(r)
    if (r.type === "income") income += amount
    else expense += amount
    count += r.count
  }
  return { income, expense, net: income - expense, count }
}

function monthlyTotals(data: FinanceData, from: string, to: string) {
  const result = []
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) {
    result.push({ month: monthKey(m), ...totals(data, maxDate(m, from), endOfMonth(m) < to ? endOfMonth(m) : to) })
  }
  return result
}

async function categoryTotals(ctx: HouseholdCtx, data: FinanceData, from: string, to: string) {
  const cats = await getDb().select().from(categories).where(eq(categories.householdId, ctx.householdId))
  const sums = new Map<string, number>()
  for (const r of data.rows) {
    if (r.status !== "posted" || r.type !== "expense" || !r.categoryId || r.date < from || r.date > to) continue
    sums.set(r.categoryId, (sums.get(r.categoryId) ?? 0) + data.value(r))
  }
  return cats.filter((c) => sums.has(c.id)).map((c) => ({ categoryId: c.id, name: c.name, color: c.color, icon: c.icon, total: sums.get(c.id)! })).sort((a, b) => b.total - a.total)
}

export async function getDashboard(ctx: HouseholdCtx, month: IsoDate) {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone)
  await ensureMaterialized(ctx.householdId, today)
  await ensureLoansMaterialized(ctx, today)
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const data = await loadFinance(ctx, pastValuationDates(monthStart, monthEnd, today))
  const obligationsUntil = maxDate(monthEnd, endOfMonth(today))
  const [monthProjection, forecast, byCategory, upcomingRows, upcomingVirtual, cats, obligations] = await Promise.all([
    project(ctx, data, monthStart, monthEnd, today),
    project(ctx, data, today, addDays(today, 90), today),
    categoryTotals(ctx, data, monthStart, monthEnd),
    listInRange(ctx, today, addDays(today, 31), { overdueBefore: today }),
    virtualOccurrences(ctx, today, addDays(today, 31), today),
    getDb().select().from(categories).where(eq(categories.householdId, ctx.householdId)),
    project(ctx, data, today, obligationsUntil, today),
  ])
  const actual = totals(data, monthStart, monthEnd)
  const planned = totals(data, monthStart, monthEnd, "planned")
  for (const v of monthProjection.virtual) {
    if (v.date < monthStart || v.date > monthEnd) continue
    if (v.type === "income") planned.income += data.value(v)
    if (v.type === "expense") planned.expense += data.value(v)
  }
  const plannedObligations = obligations.plannedItems.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0)
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const upcoming: UpcomingItem[] = [
    ...upcomingRows.filter((r) => r.status === "planned").map((r) => ({
      key: r.id, id: r.id, loanId: r.loanId, ruleId: r.recurringRuleId, date: r.date, type: r.type, amount: r.amount, currency: r.currency,
      loanPrincipal: r.loanPrincipal, loanInterest: r.loanInterest,
      title: r.title, categoryIcon: r.categoryIcon, categoryColor: r.categoryColor, overdue: r.date < today,
    })),
    ...upcomingVirtual.map((v) => ({
      key: `${v.ruleId}:${v.date}`, id: null, ruleId: v.ruleId, date: v.date, type: v.type, amount: v.amount,
      currency: data.accountMap.get(v.accountId)!.currency, title: v.title,
      categoryIcon: catMap.get(v.categoryId ?? "")?.icon ?? null, categoryColor: catMap.get(v.categoryId ?? "")?.color ?? null, overdue: false,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10)
  const [nextLoanPayment] = await transactionListQuery(and(eq(transactions.householdId, ctx.householdId), eq(transactions.status, "planned"), isNotNull(transactions.loanId), loanDisplayCondition)).orderBy(transactions.date).limit(1)
  const foreign = data.accounts.filter((a) => a.currency !== ctx.currency)
  const valuation = balanceValuation(data.rates, foreign.map((a) => a.currency), ctx.currency, today)
  return {
    nextLoanPayment,
    netAssets: data.netAssets, debt: data.debt,
    today, monthStart, balance: data.balance, monthIncome: actual.income, monthExpense: actual.expense,
    plannedIncome: planned.income, plannedExpense: planned.expense,
    forecastEndOfMonth: monthProjection.days.at(-1)?.balance ?? data.balance,
    availableAfterObligations: data.balance - plannedObligations, obligationsUntil,
    monthDays: monthProjection.days, trend: monthlyTotals(data, addMonths(monthStart, -5), monthEnd), byCategory,
    forecast: forecast.days, upcoming, warnings: [...data.fx.warnings], valuationNote: valuation.note, staleRateNotes: valuation.stale,
  }
}

export async function expenseByCategory(ctx: HouseholdCtx, from: IsoDate, to: IsoDate) {
  assertCan(ctx, "finance.read")
  return categoryTotals(ctx, await loadFinance(ctx), from, to)
}

export type CalendarItem = Pick<TransactionRow,
  "id" | "type" | "status" | "amount" | "currency" | "toAmount" | "toCurrency" | "title" | "date" | "categoryIcon" | "categoryColor" | "categoryName" | "accountName" | "toAccountName" | "authorName" | "recurringRuleId" | "version" | "loanId" | "loanPart" | "loanPrincipal" | "loanInterest"
> & { virtual: boolean; key: string }

type ProjectedOccurrence = Awaited<ReturnType<typeof project>>["virtual"][number]

function displayVirtualPayments(rows: ProjectedOccurrence[]) {
  const out: Array<ProjectedOccurrence & { loanId: string | null; loanPart: "principal" | "interest" | null; loanPrincipal: number; loanInterest: number }> = []
  const groups = new Map<string, typeof out[number]>()
  for (const row of rows) {
    if (!("loanId" in row)) {
      out.push({ ...row, loanId: null, loanPart: null, loanPrincipal: 0, loanInterest: 0 })
      continue
    }
    const key = `${row.loanId}:${row.date}`
    const existing = groups.get(key)
    if (existing) {
      existing.amount += row.amount
      existing.loanPrincipal += row.loanPart === "principal" ? row.amount : 0
      existing.loanInterest += row.loanPart === "interest" ? row.amount : 0
    } else {
      const grouped = { ...row, loanPrincipal: row.loanPart === "principal" ? row.amount : 0, loanInterest: row.loanPart === "interest" ? row.amount : 0 }
      groups.set(key, grouped)
      out.push(grouped)
    }
  }
  return out
}

export async function getCalendarMonth(ctx: HouseholdCtx, month: IsoDate) {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone)
  await ensureMaterialized(ctx.householdId, today)
  await ensureLoansMaterialized(ctx, today)
  const from = startOfMonth(month)
  const to = endOfMonth(month)
  const data = await loadFinance(ctx, pastValuationDates(from, to, today))
  const [proj, rows, cats] = await Promise.all([
    project(ctx, data, from, to, today), listInRange(ctx, from, to, today >= from && today <= to ? { overdueBefore: from } : {}),
    getDb().select().from(categories).where(eq(categories.householdId, ctx.householdId)),
  ])
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const items: CalendarItem[] = [
    ...rows.map((r) => ({ ...r, virtual: false, key: r.id })),
    ...displayVirtualPayments(proj.virtual).filter((v) => v.date >= from && v.date <= to).map((v) => ({
      id: "", key: `${v.loanId ?? v.ruleId}:${v.date}`, virtual: true, type: v.type, status: "planned" as const,
      loanId: v.loanId, loanPart: v.loanPart, loanPrincipal: v.loanPrincipal, loanInterest: v.loanInterest,
      amount: v.amount, currency: data.accountMap.get(v.accountId)!.currency, toAmount: v.toAmount,
      toCurrency: v.toAccountId ? data.accountMap.get(v.toAccountId)!.currency : null,
      title: v.title, date: v.date, categoryIcon: catMap.get(v.categoryId ?? "")?.icon ?? null,
      categoryColor: catMap.get(v.categoryId ?? "")?.color ?? null, categoryName: catMap.get(v.categoryId ?? "")?.name ?? null,
      accountName: data.accountMap.get(v.accountId)!.name, toAccountName: v.toAccountId ? data.accountMap.get(v.toAccountId)!.name : null,
      authorName: null, recurringRuleId: v.ruleId, version: 0,
    })),
  ]
  return { today, from, to, days: proj.days, items, warnings: [...data.fx.warnings] }
}

export async function getAnalytics(ctx: HouseholdCtx, from: IsoDate, to: IsoDate) {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone)
  const data = await loadFinance(ctx, pastValuationDates(from, to, today))
  const length = diffDays(to, from) + 1
  const prevTo = addDays(from, -1)
  const prevFrom = addDays(prevTo, -(length - 1))
  const current = totals(data, from, to)
  const previous = totals(data, prevFrom, prevTo)
  const [categoriesTop, historical, proj] = await Promise.all([
    categoryTotals(ctx, data, from, to), project(ctx, data, from, to, "9999-12-31"),
    project(ctx, data, today, endOfMonth(addMonths(today, 3)), today),
  ])
  const series = monthlyTotals(data, from, to).map((r) => ({
    ...r, balance: historical.days.filter((d) => monthKey(d.date) === r.month).at(-1)?.balance ?? 0,
  }))
  const forecast = [0, 1, 2, 3].map((i) => {
    const end = endOfMonth(addMonths(today, i))
    return { month: monthKey(end), balance: proj.days.find((d) => d.date === end)?.balance ?? 0 }
  })
  const change = (cur: number, prev: number) => prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10
  return {
    netAssets: data.netAssets, debt: data.debt,
    from, to, current, previous: { ...previous, from: prevFrom, to: prevTo },
    expenseChange: change(current.expense, previous.expense), incomeChange: change(current.income, previous.income),
    categories: categoriesTop, series, forecast, warnings: [...data.fx.warnings],
  }
}
